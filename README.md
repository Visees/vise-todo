# Todo

Kanban to-do boards with accounts: make as many named lists as you need, switch between them in the sidebar, and drag cards between columns. Each list starts with **To do**, **In progress**, **Da controllare** and **Done**, and anyone can add, rename, reorder and remove columns. Admins create the other users.

- **Frontend:** Angular 22 (standalone, signals, zoneless), Tailwind 4, Spartan UI, Angular Material (dialogs and their form fields, themed to the same tokens in `src/material.scss`), Angular CDK drag and drop. `frontend/src/server.ts` serves the app, proxies `/api` to the API (one origin for the browser) and sets the security headers.
- **Backend:** Express 5 + TypeScript, Zod validation, PostgreSQL 17 (`backend/`).
- **Look:** the Edicola admin "registro operativo" style (Enginy reference). See [DESIGN.md](DESIGN.md).

## Run locally

Needs Docker.

```sh
cp .env.example .env        # then set POSTGRES_PASSWORD
docker compose up -d --build
```

Open http://localhost:8090 and create the first account: it becomes the **admin**. After that, sign-up is closed and the admin creates users under **Admin → Users**. Postgres is published on `localhost:5436` for local tools only (`docker-compose.override.yml`); the production compose file publishes no ports.

To work on the code with hot reload:

```sh
docker compose up -d postgres
cd backend  && DATABASE_URL=postgres://todo:<password>@localhost:5436/todo COOKIE_SECURE=false npm run dev
cd frontend && npm start    # http://localhost:4200, proxies /api to :3000
```

The Angular CLI needs Node 22.22+ or 24.15+.

## How it works

| Thing | Where |
|---|---|
| Database schema | `backend/schema.sql`, applied by the API at every start (idempotent) |
| Accounts | `users`: email, name, scrypt password hash, `role` (`admin` or `member`) |
| Sessions | `sessions`: SHA-256 of a random token, 30 days. Cookie `todo_session` is httpOnly, SameSite=Lax; a readable `session=1` hint cookie tells the app whether to ask `/api/auth/me` at startup |
| Lists | `lists`: a named board. Everyone sees every list; anyone can add or rename one; only its creator or an admin can delete it (with all its cards), and the last list cannot be deleted. Cards from before lists existed are in the first list, "Board" |
| Columns | `board_columns`: per list, `position` left to right, `done` marks a column whose cards count as finished (struck through, never overdue, not in open counts, removed by **Clear done**). Only an empty column can be deleted, and a list keeps at least one. Cards from before columns were editable moved to the matching default column on upgrade |
| Cards | `todos`: `list_id` is the list, `column_id` the column, `position` the order in it (0 = top) |
| Drag and drop | `POST /api/todos/:id/move {columnId, index}` moves the card and renumbers both columns in one transaction |
| Users | The first account is the admin (on an upgrade, the oldest account is promoted). Sign-up is closed once a user exists, unless `ALLOW_SIGNUP=true`. Admins create, edit and delete users and reset passwords; a reset signs that user out everywhere. Everyone can change their own password with the key button next to **Sign out** (current password required; other devices are signed out). An admin cannot remove their own admin role or delete themselves, so there is always one admin |
| Login abuse | 10 failed attempts per IP per 15 minutes (`express-rate-limit`, in memory) |
| CSRF | SameSite cookies, and every write must be `application/json`, which a cross-site form cannot send |

### Board

- The sidebar shows every list with its open tasks; **+** next to **Lists** makes a new one. The pencil and bin next to **New task** rename and delete the open list. `/board` opens the list you used last on this device.
- **New task**, the **+** on a column, double-clicking a card or pressing Enter on it opens one dialog to add or edit: title, due date, column, assignee, list (to move the card to another list), and Delete. A card shows on its creator's board and its assignee's; both can edit, move and delete it.
- **Add column** (the dashed **+** after the last column) and the pencil on a column header open one dialog: name, position, and whether its cards are done; Delete works once the column is empty. Many columns scroll sideways inside the board.
- Drag a card within a column or across columns. On touch screens, hold for a moment before dragging, so the page still scrolls.
- Keyboard: Tab to a card, then **Alt + ← →** to change column and **Alt + ↑ ↓** to reorder. Screen readers hear the new position. **Enter** opens the card, **Ctrl K** jumps to search, **Ctrl B** hides or shows the sidebar.
- Search and the **Due** filter hide cards. While a filter is on, dragging is off, because positions in a filtered column do not match the real order.

## API

All routes are under `/api`. Errors are `{ "error": "message", "field"?: "name" }`.

| Method | Path | Body |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` (password ≥ 8) |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/logout` | `{}` |
| GET | `/auth/me` | returns `{ user }` (with `role`) or `{ user: null }` |
| GET | `/auth/config` | `{ signupOpen }` |
| POST | `/auth/password` | `{ currentPassword, newPassword }`; signs out your other devices |
| GET | `/lists` | every list, with the open cards you see in each |
| POST | `/lists` | `{ name }` |
| PATCH | `/lists/:id` | `{ name }` |
| DELETE | `/lists/:id` | deletes the list and its cards; its creator or an admin only; not the last list |
| GET | `/columns?listId=` | the list's columns, left to right |
| POST | `/columns` | `{ listId, name, done?, index? }` (no `index` = last); returns all the list's columns |
| PATCH | `/columns/:id` | `{ name?, done?, index? }`; changing `done` finishes or reopens its cards; returns all the list's columns |
| DELETE | `/columns/:id` | only when no card is in it (counting cards you cannot see); not the last column |
| GET | `/todos?listId=` | one list's board: cards you created plus cards assigned to you |
| POST | `/todos` | `{ listId, title, dueDate?, columnId?, assigneeId? }`, added at the top of the column (no column, or one from another list, = the best match in `listId`) |
| PATCH | `/todos/:id` | `{ title?, dueDate?, assigneeId?, listId? }` (`null` clears `dueDate` or `assigneeId`; a new `listId` puts the card at the top of the column there with the same name, else the same done flag, else the first) |
| POST | `/todos/:id/move` | `{ columnId, index }` (a column of the card's list), returns the whole board |
| DELETE | `/todos/:id` | |
| DELETE | `/todos/done?listId=` | deletes the cards you see in that list's done columns |

Admin only (403 for members):

| Method | Path | Body |
|---|---|---|
| GET | `/users` | everyone a task can be assigned to: `{ id, name }` |
| GET | `/admin/users` | users with their open and total task counts |
| POST | `/admin/users` | `{ name, email, password, role }` |
| PATCH | `/admin/users/:id` | `{ name?, email?, role?, password? }` (a new password signs the user out) |
| DELETE | `/admin/users/:id` | deletes the user and their tasks, unassigns tasks given to them; not yourself |

## Deploy with Coolify

1. New resource → Docker Compose → this Git repository and branch. Set the compose file location to `/docker-compose.yml` (Coolify defaults to `.yaml`).
2. Assign the domain to the `frontend` service, port 4000, and set `SITE_URL` to that exact address. HTTPS is automatic once the domain's DNS A record points at the server.
3. Set the environment variables from `.env.example`: a long random `POSTGRES_PASSWORD`, `SITE_URL`, `COOKIE_SECURE=true`, and `ALLOW_SIGNUP=false` unless anyone should be able to sign up.
   Then open the site and create the first account right away: it becomes the admin.
4. Turn on auto-deploy on push.
5. Turn on scheduled backups for the `postgres` service to an S3-compatible bucket off the server. If your Coolify version cannot back up a database inside a compose stack, add a scheduled task that runs `pg_dump -U todo todo | gzip` and uploads the file.

Without Coolify, the same files run on any Docker host: put a reverse proxy with HTTPS in front of `frontend:4000` and run `docker compose up -d --build`.

### Restore a backup

```sh
docker compose stop api frontend
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U todo -d todo
docker compose start api frontend
```
