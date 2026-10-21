import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

export const SESSION_COOKIE = 'todo_session';
/** Readable, non-secret hint so the app only asks /api/auth/me when a session may exist. */
export const HINT_COOKIE = 'session';

export interface User {
  id: number;
  email: string;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
  }
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  const actual = await scryptAsync(password, Buffer.from(salt!, 'hex'), 64);
  return timingSafeEqual(Buffer.from(hash!, 'hex'), actual);
}

// Checked when the email is unknown, so a failed login takes the same time either way.
const dummyHash = hashPassword(randomBytes(16).toString('hex'));

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

async function startSession(res: Response, userId: number): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const maxAge = config.sessionDays * 864e5;
  await pool.query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [
    sha256(token),
    userId,
    new Date(Date.now() + maxAge),
  ]);
  const base = { sameSite: 'lax' as const, secure: config.cookieSecure, maxAge, path: '/' };
  res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
  res.cookie(HINT_COOKIE, '1', base);
}

function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.clearCookie(HINT_COOKIE, { path: '/' });
}

async function userFromRequest(req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  const { rows } = await pool.query<User>(
    `SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  return rows[0] ?? null;
}

export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = await userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in' });
    return;
  }
  req.user = user;
  next();
}

const registerBody = z.object({
  name: z.string().trim().min(1, 'Enter your name').max(100),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});

const loginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string().max(200),
});

// 10 failed attempts per IP every 15 minutes; successful logins do not count.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in a few minutes.' },
});

export const authRouter = Router();

authRouter.post('/register', loginLimiter, async (req, res) => {
  const parsed = registerBody.safeParse(req.body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    res.status(400).json({ error: issue.message, field: issue.path[0] });
    return;
  }
  const { name, email, password } = parsed.data;
  const { rows } = await pool.query<User>(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING id, email, name`,
    [email, name, await hashPassword(password)],
  );
  const user = rows[0];
  if (!user) {
    res.status(409).json({ error: 'An account with this email already exists', field: 'email' });
    return;
  }
  await startSession(res, user.id);
  res.status(201).json({ user });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const parsed = loginBody.safeParse(req.body);
  const { rows } = parsed.success
    ? await pool.query<User & { password_hash: string }>(
        'SELECT id, email, name, password_hash FROM users WHERE lower(email) = $1',
        [parsed.data.email],
      )
    : { rows: [] };
  const found = rows[0];
  const ok = await checkPassword(parsed.data?.password ?? '', found?.password_hash ?? (await dummyHash));
  if (!found || !ok) {
    res.status(401).json({ error: 'Wrong email or password' });
    return;
  }
  await startSession(res, found.id);
  res.json({ user: { id: found.id, email: found.email, name: found.name } });
});

authRouter.post('/logout', async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/me', async (req, res) => {
  const user = await userFromRequest(req);
  if (!user) clearSession(res);
  res.json({ user });
});
