-- Applied by the api at startup. Every statement is idempotent, so it is safe on every boot.
-- Database names are snake_case; the API converts to camelCase at the boundary.

CREATE TABLE IF NOT EXISTS users (
  id            bigserial PRIMARY KEY,
  email         text NOT NULL,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
-- Admins manage other users. Added after the first release, hence ALTER.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member'));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

-- One card on the board. `status` is the column, `position` the order inside it (0 = top).
CREATE TABLE IF NOT EXISTS todos (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  status       text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  position     integer NOT NULL DEFAULT 0,
  due_date     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS todos_board_idx ON todos (user_id, status, position);
-- A card shows on its creator's board and on its assignee's. Unassigned when the assignee is deleted.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS assignee_id bigint REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS todos_assignee_idx ON todos (assignee_id, status, position);

-- There is always an admin: if none exists (fresh upgrade), the oldest account becomes one.
UPDATE users SET role = 'admin'
WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
