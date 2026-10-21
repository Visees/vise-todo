import { Router, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.js';

const STATUSES = ['todo', 'doing', 'done'] as const;
type Status = (typeof STATUSES)[number];

interface TodoRow {
  id: number;
  title: string;
  status: Status;
  position: number;
  due_date: string | null;
  created_at: Date;
  completed_at: Date | null;
}

/** snake_case row → camelCase JSON. */
const toTodo = (row: TodoRow) => ({
  id: row.id,
  title: row.title,
  status: row.status,
  position: row.position,
  dueDate: row.due_date,
  createdAt: row.created_at.toISOString(),
  completedAt: row.completed_at?.toISOString() ?? null,
});

const COLUMNS = 'id, title, status, position, due_date, created_at, completed_at';

const title = z.string().trim().min(1, 'Write something to do').max(500, 'Keep it under 500 characters');
const dueDate = z.iso.date('Invalid date').nullable();
const status = z.enum(STATUSES, 'Unknown column');

const createBody = z.object({ title, dueDate: dueDate.optional(), status: status.default('todo') });
const updateBody = z.object({ title: title.optional(), dueDate: dueDate.optional() });
const moveBody = z.object({ status, index: z.number().int().min(0) });
const idParam = z.coerce.number().int().positive();

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]!.message });
}

/** Rewrites positions 0..n-1 in the given order. */
async function renumber(client: PoolClient, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await client.query(
    `UPDATE todos SET position = o.position - 1
     FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, position)
     WHERE todos.id = o.id`,
    [ids],
  );
}

export const todosRouter = Router();

todosRouter.get('/', async (req, res) => {
  const { rows } = await pool.query<TodoRow>(
    `SELECT ${COLUMNS} FROM todos WHERE user_id = $1 ORDER BY status, position, created_at DESC`,
    [req.user!.id],
  );
  res.json({ todos: rows.map(toTodo) });
});

// New cards go to the top of their column.
todosRouter.post('/', async (req, res) => {
  const body = createBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const { rows } = await pool.query<TodoRow>(
    `INSERT INTO todos (user_id, title, due_date, status, position, completed_at)
     SELECT $1, $2, $3, $4,
            COALESCE((SELECT min(position) FROM todos WHERE user_id = $1 AND status = $4), 1) - 1,
            CASE WHEN $4 = 'done' THEN now() END
     RETURNING ${COLUMNS}`,
    [req.user!.id, body.data.title, body.data.dueDate ?? null, body.data.status],
  );
  res.status(201).json({ todo: toTodo(rows[0]!) });
});

// Registered before /:id so "done" is not read as an id.
todosRouter.delete('/done', async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM todos WHERE user_id = $1 AND status = 'done'`, [req.user!.id]);
  res.json({ removed: rowCount ?? 0 });
});

todosRouter.patch('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = updateBody.safeParse(req.body);
  if (!id.success) return badRequest(res, id.error);
  if (!body.success) return badRequest(res, body.error);
  const { title, dueDate } = body.data;
  // COALESCE keeps fields that were not sent; dueDate can be cleared with an explicit null.
  const { rows } = await pool.query<TodoRow>(
    `UPDATE todos SET
       title = COALESCE($3, title),
       due_date = CASE WHEN $4::boolean THEN $5::date ELSE due_date END
     WHERE id = $1 AND user_id = $2
     RETURNING ${COLUMNS}`,
    [id.data, req.user!.id, title ?? null, dueDate !== undefined, dueDate ?? null],
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ todo: toTodo(rows[0]) });
});

/**
 * Drag and drop: puts the card at `index` in column `status` and renumbers the
 * columns it left and entered. Returns the whole board so the client can resync.
 */
todosRouter.post('/:id/move', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = moveBody.safeParse(req.body);
  if (!id.success) return badRequest(res, id.error);
  if (!body.success) return badRequest(res, body.error);
  const userId = req.user!.id;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock this user's cards so two moves at once cannot interleave their renumbering.
    const { rows: cards } = await client.query<Pick<TodoRow, 'id' | 'status'>>(
      'SELECT id, status FROM todos WHERE user_id = $1 ORDER BY position, created_at DESC FOR UPDATE',
      [userId],
    );
    const card = cards.find((c) => c.id === id.data);
    if (!card) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    const target = cards.filter((c) => c.status === body.data.status && c.id !== card.id).map((c) => c.id);
    target.splice(Math.min(body.data.index, target.length), 0, card.id);
    await client.query(
      `UPDATE todos SET status = $2,
         completed_at = CASE WHEN $2 = 'done' THEN COALESCE(completed_at, now()) END
       WHERE id = $1`,
      [card.id, body.data.status],
    );
    await renumber(client, target);
    if (card.status !== body.data.status) {
      await renumber(client, cards.filter((c) => c.status === card.status && c.id !== card.id).map((c) => c.id));
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  const { rows } = await pool.query<TodoRow>(
    `SELECT ${COLUMNS} FROM todos WHERE user_id = $1 ORDER BY status, position, created_at DESC`,
    [userId],
  );
  res.json({ todos: rows.map(toTodo) });
});

todosRouter.delete('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return badRequest(res, id.error);
  const { rowCount } = await pool.query('DELETE FROM todos WHERE id = $1 AND user_id = $2', [id.data, req.user!.id]);
  if (!rowCount) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ ok: true });
});
