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

-- One card on the board. `column_id` (added below, with lists) is the column, `position` the order inside it (0 = top).
CREATE TABLE IF NOT EXISTS todos (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  position     integer NOT NULL DEFAULT 0,
  due_date     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
-- A card shows on its creator's board and on its assignee's. Unassigned when the assignee is deleted.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS assignee_id bigint REFERENCES users(id) ON DELETE SET NULL;

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

-- The columns of a list, left to right. Cards in a `done` column count as finished.
CREATE TABLE IF NOT EXISTS board_columns (
  id       bigserial PRIMARY KEY,
  list_id  bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name     text NOT NULL CHECK (length(name) BETWEEN 1 AND 50),
  position integer NOT NULL DEFAULT 0,
  done     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS board_columns_list_idx ON board_columns (list_id, position);
-- Every list has columns. Same defaults as DEFAULT_COLUMNS in src/lists.ts.
INSERT INTO board_columns (list_id, name, position, done)
SELECT l.id, d.name, d.position, d.done
FROM lists l CROSS JOIN (VALUES ('To do', 0, false), ('In progress', 1, false), ('Da controllare', 2, false), ('Done', 3, true)) AS d(name, position, done)
WHERE NOT EXISTS (SELECT 1 FROM board_columns c WHERE c.list_id = l.id);
-- A column with cards cannot be deleted (the API turns the violation into a message); deleting the list removes both.
ALTER TABLE todos ADD COLUMN IF NOT EXISTS column_id bigint REFERENCES board_columns(id);
-- Cards from before columns could be edited had a fixed `status`: move them to the matching default column, once.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'todos' AND column_name = 'status') THEN
    UPDATE todos t SET column_id = c.id
    FROM board_columns c
    WHERE t.column_id IS NULL AND c.list_id = t.list_id
      AND c.name = CASE t.status WHEN 'todo' THEN 'To do' WHEN 'doing' THEN 'In progress' ELSE 'Done' END;
    ALTER TABLE todos DROP COLUMN status;
  END IF;
END $$;
ALTER TABLE todos ALTER COLUMN column_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS todos_column_idx ON todos (column_id, position);
CREATE INDEX IF NOT EXISTS todos_list_idx ON todos (list_id);
CREATE INDEX IF NOT EXISTS todos_user_idx ON todos (user_id);
CREATE INDEX IF NOT EXISTS todos_assignee_idx ON todos (assignee_id);

-- There is always an admin: if none exists (fresh upgrade), the oldest account becomes one.
UPDATE users SET role = 'admin'
WHERE id = (SELECT id FROM users ORDER BY id LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');
