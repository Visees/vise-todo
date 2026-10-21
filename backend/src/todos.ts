import { Router, type Response } from 'express';
import { z } from 'zod';
import { pool } from './db.js';

interface TodoRow {
  id: number;
  title: string;
  done: boolean;
  due_date: string | null;
  created_at: Date;
  completed_at: Date | null;
}

/** snake_case row → camelCase JSON. */
const toTodo = (row: TodoRow) => ({
  id: row.id,
  title: row.title,
  done: row.done,
  dueDate: row.due_date,
  createdAt: row.created_at.toISOString(),
  completedAt: row.completed_at?.toISOString() ?? null,
});

const COLUMNS = 'id, title, done, due_date, created_at, completed_at';

const title = z.string().trim().min(1, 'Write something to do').max(500, 'Keep it under 500 characters');
const dueDate = z.iso.date('Invalid date').nullable();

const createBody = z.object({ title, dueDate: dueDate.optional() });
const updateBody = z.object({ title: title.optional(), dueDate: dueDate.optional(), done: z.boolean().optional() });
const idParam = z.coerce.number().int().positive();

function badRequest(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]!.message });
}

export const todosRouter = Router();

todosRouter.get('/', async (req, res) => {
  const { rows } = await pool.query<TodoRow>(
    `SELECT ${COLUMNS} FROM todos WHERE user_id = $1 ORDER BY done, created_at DESC`,
    [req.user!.id],
  );
  res.json({ todos: rows.map(toTodo) });
});

todosRouter.post('/', async (req, res) => {
  const body = createBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const { rows } = await pool.query<TodoRow>(
    `INSERT INTO todos (user_id, title, due_date) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
    [req.user!.id, body.data.title, body.data.dueDate ?? null],
  );
  res.status(201).json({ todo: toTodo(rows[0]!) });
});

// Registered before /:id so "completed" is not read as an id.
todosRouter.delete('/completed', async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM todos WHERE user_id = $1 AND done', [req.user!.id]);
  res.json({ removed: rowCount ?? 0 });
});

todosRouter.patch('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = updateBody.safeParse(req.body);
  if (!id.success) return badRequest(res, id.error);
  if (!body.success) return badRequest(res, body.error);
  const { title, dueDate, done } = body.data;
  // COALESCE keeps fields that were not sent; dueDate can be cleared with an explicit null.
  const { rows } = await pool.query<TodoRow>(
    `UPDATE todos SET
       title = COALESCE($3, title),
       due_date = CASE WHEN $4::boolean THEN $5::date ELSE due_date END,
       done = COALESCE($6, done),
       completed_at = CASE
         WHEN COALESCE($6, done) = false THEN NULL
         ELSE COALESCE(completed_at, now()) END
     WHERE id = $1 AND user_id = $2
     RETURNING ${COLUMNS}`,
    [id.data, req.user!.id, title ?? null, dueDate !== undefined, dueDate ?? null, done ?? null],
  );
  if (!rows[0]) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ todo: toTodo(rows[0]) });
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
