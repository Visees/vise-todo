import { Router, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { pool } from './db.js';

interface ColumnRow {
  id: number;
  list_id: number;
  name: string;
  position: number;
  done: boolean;
}

const toColumn = (row: ColumnRow) => ({
  id: row.id,
  listId: row.list_id,
  name: row.name,
  position: row.position,
  done: row.done,
});

const name = z.string().trim().min(1, 'Give the column a name').max(50, 'Keep it under 50 characters');
const done = z.boolean();
/** Where the column goes, 0 = first. Past the end means last. */
const index = z.number().int().min(0);
const listId = z.coerce.number('Pick a list').int().positive('Pick a list');

const createBody = z.object({ listId, name, done: done.default(false), index: index.optional() });
const updateBody = z.object({ name: name.optional(), done: done.optional(), index: index.optional() });
const listQuery = z.object({ listId });
const idParam = z.coerce.number().int().positive();

function badRequest(res: Response, error: z.ZodError): void {
  const issue = error.issues[0]!;
  res.status(400).json({ error: issue.message, field: issue.path[0] });
}

async function listColumns(client: PoolClient | typeof pool, listId: number) {
  const { rows } = await client.query<ColumnRow>('SELECT * FROM board_columns WHERE list_id = $1 ORDER BY position, id', [listId]);
  return rows.map(toColumn);
}

/** Runs `work` in a transaction holding the list's columns, in order, locked against other changes. */
async function withColumns<T>(listId: number, work: (client: PoolClient, ids: number[]) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: number }>(
      'SELECT id FROM board_columns WHERE list_id = $1 ORDER BY position, id FOR UPDATE',
      [listId],
    );
    const result = await work(client, rows.map((r) => r.id));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Rewrites positions 0..n-1 in the given order. */
async function renumber(client: PoolClient, ids: number[]): Promise<void> {
  await client.query(
    `UPDATE board_columns SET position = o.position - 1
     FROM unnest($1::bigint[]) WITH ORDINALITY AS o(id, position)
     WHERE board_columns.id = o.id`,
    [ids],
  );
}

/** Mounted behind requireUser. Like lists, everyone can add, rename and reorder columns. */
export const columnsRouter = Router();

columnsRouter.get('/', async (req, res) => {
  const query = listQuery.safeParse(req.query);
  if (!query.success) return badRequest(res, query.error);
  res.json({ columns: await listColumns(pool, query.data.listId) });
});

// Every write answers with all the list's columns, since positions may have shifted.
columnsRouter.post('/', async (req, res) => {
  const body = createBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const { listId, name, done, index } = body.data;
  const { rows } = await pool.query('SELECT 1 FROM lists WHERE id = $1', [listId]);
  if (!rows[0]) {
    res.status(400).json({ error: 'That list no longer exists' });
    return;
  }
  const columns = await withColumns(listId, async (client, ids) => {
    const { rows } = await client.query<{ id: number }>(
      'INSERT INTO board_columns (list_id, name, done, position) VALUES ($1, $2, $3, $4) RETURNING id',
      [listId, name, done, ids.length],
    );
    ids.splice(index ?? ids.length, 0, rows[0]!.id);
    await renumber(client, ids);
    return listColumns(client, listId);
  });
  res.status(201).json({ columns });
});

columnsRouter.patch('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = updateBody.safeParse(req.body);
  if (!id.success) return badRequest(res, id.error);
  if (!body.success) return badRequest(res, body.error);
  const { rows } = await pool.query<Pick<ColumnRow, 'list_id'>>('SELECT list_id FROM board_columns WHERE id = $1', [id.data]);
  const listId = rows[0]?.list_id;
  if (!listId) {
    res.status(404).json({ error: 'Column not found' });
    return;
  }
  const { name, done, index } = body.data;
  const columns = await withColumns(listId, async (client, ids) => {
    await client.query('UPDATE board_columns SET name = COALESCE($2, name), done = COALESCE($3, done) WHERE id = $1', [
      id.data,
      name ?? null,
      done ?? null,
    ]);
    // Its cards become finished, or open again, with it.
    if (done !== undefined) {
      await client.query('UPDATE todos SET completed_at = CASE WHEN $2::boolean THEN COALESCE(completed_at, now()) END WHERE column_id = $1', [
        id.data,
        done,
      ]);
    }
    if (index !== undefined) {
      const others = ids.filter((c) => c !== id.data);
      others.splice(index, 0, id.data);
      await renumber(client, others);
    }
    return listColumns(client, listId);
  });
  res.json({ columns });
});

// Only an empty column can go, so no card is lost by accident; a list keeps at least one column.
columnsRouter.delete('/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return badRequest(res, id.error);
  const { rows } = await pool.query<Pick<ColumnRow, 'list_id'>>('SELECT list_id FROM board_columns WHERE id = $1', [id.data]);
  const listId = rows[0]?.list_id;
  if (!listId) {
    res.status(404).json({ error: 'Column not found' });
    return;
  }
  const result = await withColumns(listId, async (client, ids) => {
    if (ids.length <= 1) return 'last' as const;
    // Checks every card, including ones this user does not see: those would be lost too.
    const { rows } = await client.query('SELECT 1 FROM todos WHERE column_id = $1 LIMIT 1', [id.data]);
    if (rows[0]) return 'busy' as const;
    await client.query('DELETE FROM board_columns WHERE id = $1', [id.data]);
    await renumber(client, ids.filter((c) => c !== id.data));
    return listColumns(client, listId);
  });
  if (result === 'last') {
    res.status(400).json({ error: 'A list needs at least one column' });
    return;
  }
  if (result === 'busy') {
    res.status(400).json({ error: 'Move or delete the tasks in this column first (including any you cannot see)' });
    return;
  }
  res.json({ columns: result });
});
