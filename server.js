import express from 'express'
import { DatabaseSync } from 'node:sqlite'
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 3100
const SESSION_DAYS = 30
const COOKIE = 'todo_session'

// ── Database ────────────────────────────────────────────────────────────────
const db = new DatabaseSync(process.env.DB_PATH || path.join(ROOT, 'data.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS todos_user ON todos(user_id);
`)

// ── Passwords and sessions ─────────────────────────────────────────────────
function hashPassword(password) {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`
}

function checkPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const expected = Buffer.from(hash, 'hex')
  const actual = scryptSync(password, Buffer.from(salt, 'hex'), 64)
  return timingSafeEqual(expected, actual)
}

// Used when the email is unknown, so a login takes the same time either way.
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'))

function startSession(res, userId) {
  const token = randomBytes(32).toString('hex')
  const expires = Date.now() + SESSION_DAYS * 864e5
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires)
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 864e5,
  })
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return decodeURIComponent(v.join('='))
  }
  return null
}

function currentUser(req) {
  const token = readCookie(req, COOKIE)
  if (!token) return null
  return db.prepare(`
    SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?
  `).get(token, Date.now()) ?? null
}

function requireUser(req, res, next) {
  const user = currentUser(req)
  if (!user) return res.status(401).json({ error: 'Not signed in' })
  req.user = user
  next()
}

// ── App ────────────────────────────────────────────────────────────────────
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '20kb' }))
app.use(express.static(path.join(ROOT, 'public')))
app.use('/fonts', express.static(path.join(ROOT, 'node_modules/@fontsource-variable/inter/files')))

// Mutating calls must be JSON: a cross-site form post cannot send that.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) {
    return res.status(415).json({ error: 'Expected JSON' })
  }
  next()
})

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

app.post('/api/register', (req, res) => {
  const name = String(req.body.name ?? '').trim()
  const email = String(req.body.email ?? '').trim().toLowerCase()
  const password = String(req.body.password ?? '')
  if (!name) return res.status(400).json({ error: 'Enter your name', field: 'name' })
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email', field: 'email' })
  if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters', field: 'password' })
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'An account with this email already exists', field: 'email' })
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
    .run(email, name, hashPassword(password), Date.now())
  startSession(res, Number(lastInsertRowid))
  res.status(201).json({ user: { id: Number(lastInsertRowid), email, name } })
})

app.post('/api/login', (req, res) => {
  const email = String(req.body.email ?? '').trim().toLowerCase()
  const password = String(req.body.password ?? '')
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  const ok = checkPassword(password, user?.password_hash ?? DUMMY_HASH) && user
  if (!ok) return res.status(401).json({ error: 'Wrong email or password' })
  startSession(res, user.id)
  res.json({ user: { id: user.id, email: user.email, name: user.name } })
})

app.post('/api/logout', (req, res) => {
  const token = readCookie(req, COOKIE)
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
  res.clearCookie(COOKIE)
  res.json({ ok: true })
})

app.get('/api/me', (req, res) => {
  res.json({ user: currentUser(req) })
})

const toTodo = (row) => ({ ...row, done: Boolean(row.done) })

app.get('/api/todos', requireUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY done, created_at DESC').all(req.user.id)
  res.json({ todos: rows.map(toTodo) })
})

function cleanDue(value) {
  if (value == null || value === '') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

app.post('/api/todos', requireUser, (req, res) => {
  const title = String(req.body.title ?? '').trim().slice(0, 500)
  const due = cleanDue(req.body.due_date)
  if (!title) return res.status(400).json({ error: 'Write something to do' })
  if (due === undefined) return res.status(400).json({ error: 'Invalid date' })
  const { lastInsertRowid } = db
    .prepare('INSERT INTO todos (user_id, title, due_date, created_at) VALUES (?, ?, ?, ?)')
    .run(req.user.id, title, due, Date.now())
  res.status(201).json({ todo: toTodo(db.prepare('SELECT * FROM todos WHERE id = ?').get(lastInsertRowid)) })
})

app.patch('/api/todos/:id', requireUser, (req, res) => {
  const todo = db.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!todo) return res.status(404).json({ error: 'Not found' })
  const title = req.body.title === undefined ? todo.title : String(req.body.title).trim().slice(0, 500)
  const due = req.body.due_date === undefined ? todo.due_date : cleanDue(req.body.due_date)
  const done = req.body.done === undefined ? Boolean(todo.done) : Boolean(req.body.done)
  if (!title) return res.status(400).json({ error: 'Write something to do' })
  if (due === undefined) return res.status(400).json({ error: 'Invalid date' })
  const completedAt = done ? (todo.completed_at ?? Date.now()) : null
  db.prepare('UPDATE todos SET title = ?, due_date = ?, done = ?, completed_at = ? WHERE id = ?')
    .run(title, due, done ? 1 : 0, completedAt, todo.id)
  res.json({ todo: toTodo(db.prepare('SELECT * FROM todos WHERE id = ?').get(todo.id)) })
})

app.delete('/api/todos/:id', requireUser, (req, res) => {
  const { changes } = db.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id)
  if (!changes) return res.status(404).json({ error: 'Not found' })
  res.json({ ok: true })
})

app.post('/api/todos/clear-completed', requireUser, (req, res) => {
  const { changes } = db.prepare('DELETE FROM todos WHERE user_id = ? AND done = 1').run(req.user.id)
  res.json({ removed: Number(changes) })
})

db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())

app.listen(PORT, () => console.log(`Todo running on http://localhost:${PORT}`))
