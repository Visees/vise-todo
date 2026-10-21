import express, { type ErrorRequestHandler } from 'express';
import { authRouter, requireUser } from './auth.js';
import { config } from './config.js';
import { migrate, pool } from './db.js';
import { todosRouter } from './todos.js';

const app = express();
app.disable('x-powered-by');
// One proxy hop (the frontend server); Traefik's address arrives in X-Forwarded-For.
app.set('trust proxy', 2);
app.use(express.json({ limit: '20kb' }));

app.get('/api/health', async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
});

// Writes must be JSON: a cross-site HTML form cannot send that content type.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'DELETE' && !req.is('application/json')) {
    res.status(415).json({ error: 'Expected JSON' });
    return;
  }
  next();
});

app.use('/api/auth', authRouter);
app.use('/api/todos', requireUser, todosRouter);

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const onError: ErrorRequestHandler = (err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Try again.' });
};
app.use(onError);

await migrate();
await pool.query('DELETE FROM sessions WHERE expires_at < now()');
app.listen(config.port, () => console.log(`API listening on :${config.port}`));
