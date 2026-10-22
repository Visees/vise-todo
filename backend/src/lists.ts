import { Router, type Response } from 'express';
import { z } from 'zod';
import { pool } from './db.js';

interface ListRow {
  id: number;
  name: string;
  created_by: number | null;
  open_tasks: number;
}

const toList = (row: ListRow) => ({
  id: row.id,
  name: row.name,
  createdBy: row.created_by,
  openTasks: row.open_tasks,
});

/** Lists with the open cards this user sees in each ($1 user, $2 see all tasks). */
const SELECT_LISTS = `
  SELECT l.id, l.name, l.created_by,
         count(t.id) FILTER (WHERE t.status <> 'done' AND ($2::boolean OR t.user_id = $1 OR t.assignee_id = $1))::int AS open_tasks
  FROM lists l LEFT JOIN todos t ON t.list_id = l.id`;

const body = z.object({ name: z.string().trim().min(1, 'Give the list a name').max(100, 'Keep it under 100 characters') });
const idParam = z.coerce.number().int().positive();

function badRequest(res: Response, error: z.ZodError): void {
  const issue = error.issues[0]!;
  res.status(400).json({ error: issue.message, field: issue.path[0] });
}

async function findList(id: number, userId: number, seeAllTasks: boolean) {
  const { rows } = await pool.query<ListRow>(`${SELECT_LISTS} WHERE l.id = $3 GROUP BY l.id`, [userId, seeAllTasks, id]);
  return rows[0] ? toList(rows[0]) : null;
}

/** Mounted behind requireUser. Anyone can add and rename lists. */
export const listsRouter = Router();

listsRouter.get('/', async (req, res) => {
  const { rows } = await pool.query<ListRow>(`${SELECT_LISTS} GROUP BY l.id ORDER BY l.id`, [
    req.user!.id,
    req.user!.seeAllTasks,
  ]);
  res.json({ lists: rows.map(toList) });
});

listsRouter.post('/', async (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const { rows } = await pool.query<{ id: number }>('INSERT INTO lists (name, created_by) VALUES ($1, $2) RETURNING id', [
    parsed.data.name,
    req.user!.id,
  ]);
  res.status(201).json({ list: await findList(rows[0]!.id, req.user!.id, req.user!.seeAllTasks) });
});

listsRouter.patch('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const parsed = body.safeParse(req.body);
  if (!id.success) return badRequest(res, id.error);
  if (!parsed.success) return badRequest(res, parsed.error);
  const { rowCount } = await pool.query('UPDATE lists SET name = $2 WHERE id = $1', [id.data, parsed.data.name]);
  if (!rowCount) {
    res.status(404).json({ error: 'List not found' });
    return;
  }
  res.json({ list: await findList(id.data, req.user!.id, req.user!.seeAllTasks) });
});

// Deleting a list deletes every card in it (ON DELETE CASCADE), so only its creator or an admin may.
listsRouter.delete('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return badRequest(res, id.error);
  const { rows } = await pool.query<{ created_by: number | null; total: number }>(
    'SELECT created_by, (SELECT count(*)::int FROM lists) AS total FROM lists WHERE id = $1',
    [id.data],
  );
  const list = rows[0];
  if (!list) {
    res.status(404).json({ error: 'List not found' });
    return;
  }
  if (list.created_by !== req.user!.id && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Only the person who made this list, or an admin, can delete it' });
    return;
  }
  if (list.total <= 1) {
    res.status(400).json({ error: 'You cannot delete the last list' });
    return;
  }
  await pool.query('DELETE FROM lists WHERE id = $1', [id.data]);
  res.json({ ok: true });
});
