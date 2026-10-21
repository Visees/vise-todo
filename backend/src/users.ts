import { Router } from 'express';
import { pool } from './db.js';

/** Everyone a task can be assigned to. Mounted behind requireUser. */
export const usersRouter = Router();

usersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query<{ id: number; name: string }>('SELECT id, name FROM users ORDER BY lower(name)');
  res.json({ users: rows });
});
