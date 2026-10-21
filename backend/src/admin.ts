import { Router, type Response } from 'express';
import { z } from 'zod';
import { endSessions, hashPassword, registerBody } from './auth.js';
import { pool } from './db.js';

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: 'admin' | 'member';
  see_all_tasks: boolean;
  created_at: Date;
  open_tasks: number;
  total_tasks: number;
}

const toUser = (row: UserRow) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role,
  seeAllTasks: row.see_all_tasks,
  createdAt: row.created_at.toISOString(),
  openTasks: row.open_tasks,
  totalTasks: row.total_tasks,
});

const SELECT_USERS = `
  SELECT u.id, u.name, u.email, u.role, u.see_all_tasks, u.created_at,
         count(t.id) FILTER (WHERE t.status <> 'done')::int AS open_tasks,
         count(t.id)::int AS total_tasks
  FROM users u LEFT JOIN todos t ON t.user_id = u.id OR t.assignee_id = u.id`;

const role = z.enum(['admin', 'member'], 'Unknown role');
const seeAllTasks = z.boolean();
const createBody = registerBody.extend({ role, seeAllTasks: seeAllTasks.default(false) });
const updateBody = registerBody.partial().extend({ role: role.optional(), seeAllTasks: seeAllTasks.optional() });
const idParam = z.coerce.number().int().positive();

function badRequest(res: Response, error: z.ZodError): void {
  const issue = error.issues[0]!;
  res.status(400).json({ error: issue.message, field: issue.path[0] });
}

async function findUser(id: number) {
  const { rows } = await pool.query<UserRow>(`${SELECT_USERS} WHERE u.id = $1 GROUP BY u.id`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
}

/** Mounted behind requireUser + requireAdmin. */
export const adminRouter = Router();

adminRouter.get('/users', async (_req, res) => {
  const { rows } = await pool.query<UserRow>(`${SELECT_USERS} GROUP BY u.id ORDER BY lower(u.name)`);
  res.json({ users: rows.map(toUser) });
});

adminRouter.post('/users', async (req, res) => {
  const body = createBody.safeParse(req.body);
  if (!body.success) return badRequest(res, body.error);
  const { name, email, password, role, seeAllTasks } = body.data;
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO users (email, name, password_hash, role, see_all_tasks) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT DO NOTHING RETURNING id`,
    [email, name, await hashPassword(password), role, seeAllTasks],
  );
  if (!rows[0]) {
    res.status(409).json({ error: 'An account with this email already exists', field: 'email' });
    return;
  }
  res.status(201).json({ user: await findUser(rows[0].id) });
});

adminRouter.patch('/users/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  const body = updateBody.safeParse(req.body);
  if (!id.success) return badRequest(res, id.error);
  if (!body.success) return badRequest(res, body.error);
  const { name, email, password, role, seeAllTasks } = body.data;
  // Keeps at least one admin: you cannot demote yourself.
  if (id.data === req.user!.id && role === 'member') {
    res.status(400).json({ error: 'You cannot remove your own admin role', field: 'role' });
    return;
  }
  try {
    const { rowCount } = await pool.query(
      `UPDATE users SET
         name = COALESCE($2, name),
         email = COALESCE($3, email),
         role = COALESCE($4, role),
         password_hash = COALESCE($5, password_hash),
         see_all_tasks = COALESCE($6, see_all_tasks)
       WHERE id = $1`,
      [id.data, name ?? null, email ?? null, role ?? null, password ? await hashPassword(password) : null, seeAllTasks ?? null],
    );
    if (!rowCount) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      res.status(409).json({ error: 'An account with this email already exists', field: 'email' });
      return;
    }
    throw err;
  }
  // A new password signs the user out everywhere, except the admin resetting their own.
  if (password && id.data !== req.user!.id) await endSessions(id.data);
  res.json({ user: await findUser(id.data) });
});

adminRouter.delete('/users/:id', async (req, res) => {
  const id = idParam.safeParse(req.params.id);
  if (!id.success) return badRequest(res, id.error);
  if (id.data === req.user!.id) {
    res.status(400).json({ error: 'You cannot delete your own account' });
    return;
  }
  // Their tasks and sessions go with them (ON DELETE CASCADE); tasks assigned to them become unassigned.
  const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id.data]);
  if (!rowCount) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json({ ok: true });
});
