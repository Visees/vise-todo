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
-- Set by an admin: the user's board shows every card, not only the ones they created or were assigned.
ALTER TABLE users ADD COLUMN IF NOT EXISTS see_all_tasks boolean NOT NULL DEFAULT false;

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

-- A named board. Everyone sees every list; inside one, the usual card visibility applies.
CREATE TABLE IF NOT EXISTS lists (
  id         bigserial PRIMARY KEY,
  name       text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- There is always a list. The first one takes the cards from before lists existed.
INSERT INTO lists (name) SELECT 'Board' WHERE NOT EXISTS (SELECT 1 FROM lists);
ALTER TABLE todos ADD COLUMN IF NOT EXISTS list_id bigint REFERENCES lists(id) ON DELETE CASCADE;
UPDATE todos SET list_id = (SELECT min(id) FROM lists) WHERE list_id IS NULL;
ALTER TABLE todos ALTER COLUMN list_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS todos_list_idx ON todos (list_id, status, position);

-- There is always an admin: if none exists (fresh upgrade), the oldest account becomes one.
UPDATE users SET role = 'admin'
WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
