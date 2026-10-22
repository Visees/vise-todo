import { Router, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.js';

const STATUSES = ['todo', 'doing', 'done'] as const;
type Status = (typeof STATUSES)[number];

interface TodoRow {
  id: number;
  user_id: number;
  list_id: number;
  title: string;
  status: Status;
  position: number;
  due_date: string | null;
  created_at: Date;
  completed_at: Date | null;
  assignee_id: number | null;
  assignee_name: string | null;
}

/** snake_case row → camelCase JSON. */
const toTodo = (row: TodoRow) => ({
  id: row.id,
  ownerId: row.user_id,
  listId: row.list_id,
  title: row.title,
  status: row.status,
  position: row.position,
  dueDate: row.due_date,
  createdAt: row.created_at.toISOString(),
  completedAt: row.completed_at?.toISOString() ?? null,
  assignee: row.assignee_id ? { id: row.assignee_id, name: row.assignee_name! } : null,
});

/** Cards from `source` (the table or a CTE of changed rows) with their assignee's name. */
const selectFrom = (source: string) =>
  `SELECT t.id, t.user_id, t.list_id, t.title, t.status, t.position, t.due_date, t.created_at, t.completed_at,
          t.assignee_id, a.name AS assignee_name
   FROM ${source} t LEFT JOIN users a ON a.id = t.assignee_id`;

/** A user's board in list $3: the cards they created plus the ones assigned to them, or every card when $2 (see all tasks) is set. */
const BOARD = `${selectFrom('todos')} WHERE t.list_id = $3 AND ($2::boolean OR t.user_id = $1 OR t.assignee_id = $1)
  ORDER BY t.status, t.position, t.created_at DESC`;

const title = z.string().trim().min(1, 'Write something to do').max(500, 'Keep it under 500 characters');
const dueDate = z.iso.date('Invalid date').nullable();
const status = z.enum(STATUSES, 'Unknown column');
const assigneeId = z.number().int().positive().nullable();
const listId = z.coerce.number('Pick a list').int().positive('Pick a list');

const createBody = z.object({ listId, title, dueDate: dueDate.optional(), status: status.default('todo'), assigneeId: assigneeId.optional() });
const updateBody = z.object({ title: title.optional(), dueDate: dueDate.optional(), assigneeId: assigneeId.optional(), listId: listId.optional() });
const moveBody = z.object({ status, index: z.number().int().min(0) });
const listQuery = z.object({ listId });
const idParam = z.coerce.number().int().positive();

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]!.message });
}

/** Foreign key violation: the assignee or the list does not exist (any more). Null for any other error. */
function missingReference(err: unknown): string | null {
  const { code, constraint } = err as { code?: string; constraint?: string };
  if (code !== '23503') return null;
  return constraint === 'todos_list_id_fkey' ? 'That list no longer exists' : 'That user no longer exists';
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
  const query = listQuery.safeParse(req.query);
  if (!query.success) return badRequest(res, query.error);
  const { rows } = await pool.query<TodoRow>(BOARD, [req.user!.id, req.user!.seeAllTasks, query.data.listId]);
  res.json({ todos: rows.map(toTodo) });
});

// New cards go to the top of their column in the list, for everyone who sees them.
todosRouter.post('/', async (req, res) => {
  const body = createBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  try {
    const { rows } = await pool.query<TodoRow>(
      `WITH changed AS (
         INSERT INTO todos (user_id, list_id, title, due_date, status, assignee_id, position, completed_at)
         SELECT $1, $6, $2, $3, $4, $5,
                COALESCE((SELECT min(position) FROM todos WHERE list_id = $6 AND status = $4), 1) - 1,
                CASE WHEN $4 = 'done' THEN now() END
         RETURNING *)
       ${selectFrom('changed')}`,
      [req.user!.id, body.data.title, body.data.dueDate ?? null, body.data.status, body.data.assigneeId ?? null, body.data.listId],
    );
    res.status(201).json({ todo: toTodo(rows[0]!) });
  } catch (err) {
    const message = missingReference(err);
    if (!message) throw err;
    res.status(400).json({ error: message });
  }
});

// Registered before /:id so "done" is not read as an id.
todosRouter.delete('/done', async (req, res) => {
  const query = listQuery.safeParse(req.query);
  if (!query.success) return badRequest(res, query.error);
  const { rowCount } = await pool.query(
    `DELETE FROM todos WHERE list_id = $3 AND ($2::boolean OR user_id = $1 OR assignee_id = $1) AND status = 'done'`,
    [req.user!.id, req.user!.seeAllTasks, query.data.listId],
  );
  res.json({ removed: rowCount ?? 0 });
});

todosRouter.patch('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = updateBody.safeParse(req.body);
  if (!id.success) return badRequest(res, id.error);
  if (!body.success) return badRequest(res, body.error);
  const { title, dueDate, assigneeId, listId } = body.data;
  // COALESCE keeps fields that were not sent; dueDate and assigneeId can be cleared with an explicit null.
  // A card sent to another list goes to the top of the same column there.
  try {
    const { rows } = await pool.query<TodoRow>(
      `WITH changed AS (
         UPDATE todos t SET
           title = COALESCE($3, t.title),
           due_date = CASE WHEN $4::boolean THEN $5::date ELSE t.due_date END,
           assignee_id = CASE WHEN $6::boolean THEN $7::bigint ELSE t.assignee_id END,
           list_id = COALESCE($9::bigint, t.list_id),
           position = CASE WHEN $9::bigint <> t.list_id
             THEN COALESCE((SELECT min(o.position) FROM todos o WHERE o.list_id = $9 AND o.status = t.status), 1) - 1
             ELSE t.position END
         WHERE t.id = $1 AND ($8::boolean OR t.user_id = $2 OR t.assignee_id = $2)
         RETURNING t.*)
       ${selectFrom('changed')}`,
      [
        id.data,
        req.user!.id,
        title ?? null,
        dueDate !== undefined,
        dueDate ?? null,
        assigneeId !== undefined,
        assigneeId ?? null,
        req.user!.seeAllTasks,
        listId ?? null,
      ],
    );
    if (!rows[0]) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json({ todo: toTodo(rows[0]) });
  } catch (err) {
    const message = missingReference(err);
    if (!message) throw err;
    res.status(400).json({ error: message });
  }
});

/**
 * Drag and drop: puts the card at `index` in column `status` of its list and renumbers
 * the columns it left and entered. Returns the whole board so the client can resync.
 */
todosRouter.post('/:id/move', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = moveBody.safeParse(req.body);
  if (!id.success) return badRequest(res, id.error);
  if (!body.success) return badRequest(res, body.error);
  const { id: userId, seeAllTasks } = req.user!;
  const { rows: found } = await pool.query<Pick<TodoRow, 'list_id'>>('SELECT list_id FROM todos WHERE id = $1', [id.data]);
  const listId = found[0]?.list_id;
  if (!listId) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Lock this board's cards so two moves at once cannot interleave their renumbering.
    const { rows: cards } = await client.query<Pick<TodoRow, 'id' | 'status'>>(
      `SELECT id, status FROM todos WHERE list_id = $3 AND ($2::boolean OR user_id = $1 OR assignee_id = $1)
       ORDER BY position, created_at DESC FOR UPDATE`,
      [userId, seeAllTasks, listId],
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
  const { rows } = await pool.query<TodoRow>(BOARD, [userId, seeAllTasks, listId]);
  res.json({ todos: rows.map(toTodo) });
});

todosRouter.delete('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return badRequest(res, id.error);
  const { rowCount } = await pool.query(
    'DELETE FROM todos WHERE id = $1 AND ($3::boolean OR user_id = $2 OR assignee_id = $2)',
    [id.data, req.user!.id, req.user!.seeAllTasks],
  );
  if (!rowCount) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ ok: true });
});
