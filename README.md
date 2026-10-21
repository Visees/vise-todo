# Todo

A Kanban to-do board with accounts: sign up, sign in, and drag cards between **To do**, **In progress** and **Done**. The card order is saved per user.

- **Frontend:** Angular 22 (standalone, signals, zoneless), Tailwind 4, Spartan UI, Angular CDK drag and drop. `frontend/src/server.ts` serves the app, proxies `/api` to the API (one origin for the browser) and sets the security headers.
- **Backend:** Express 5 + TypeScript, Zod validation, PostgreSQL 17 (`backend/`).
- **Look:** the Edicola admin "registro operativo" style (Enginy reference). See [DESIGN.md](DESIGN.md).

## Run locally

Needs Docker.

```sh
cp .env.example .env        # then set POSTGRES_PASSWORD
docker compose up -d --build
```

Open http://localhost:8090 and create an account. Postgres is published on `localhost:5436` for local tools only (`docker-compose.override.yml`); the production compose file publishes no ports.

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
| Accounts | `users`: email, name, scrypt password hash |
| Sessions | `sessions`: SHA-256 of a random token, 30 days. Cookie `todo_session` is httpOnly, SameSite=Lax; a readable `session=1` hint cookie tells the app whether to ask `/api/auth/me` at startup |
| Cards | `todos`: `status` is the column, `position` the order in it (0 = top) |
| Drag and drop | `POST /api/todos/:id/move {status, index}` moves the card and renumbers both columns in one transaction |
| Login abuse | 10 failed attempts per IP per 15 minutes (`express-rate-limit`, in memory) |
| CSRF | SameSite cookies, and every write must be `application/json`, which a cross-site form cannot send |

### Board

- Drag a card within a column or across columns. On touch screens, hold for a moment before dragging, so the page still scrolls.
- Keyboard: Tab to a card, then **Alt + ← →** to change column and **Alt + ↑ ↓** to reorder. Screen readers hear the new position. **Enter** edits the title, **Ctrl K** jumps to search.
- Search and the **Due** filter hide cards. While a filter is on, dragging is off, because positions in a filtered column do not match the real order.

## API

All routes are under `/api`. Errors are `{ "error": "message", "field"?: "name" }`.

| Method | Path | Body |
|---|---|---|
| POST | `/auth/register` | `{ name, email, password }` (password ≥ 8) |
| POST | `/auth/login` | `{ email, password }` |
| POST | `/auth/logout` | `{}` |
| GET | `/auth/me` | returns `{ user }` or `{ user: null }` |
| GET | `/todos` | the whole board |
| POST | `/todos` | `{ title, dueDate?, status? }`, added at the top of the column |
| PATCH | `/todos/:id` | `{ title?, dueDate? }` (`dueDate: null` clears it) |
| POST | `/todos/:id/move` | `{ status, index }`, returns the whole board |
| DELETE | `/todos/:id` | |
| DELETE | `/todos/done` | empties the Done column |

## Deploy with Coolify

1. New resource → Docker Compose → this Git repository and branch. Set the compose file location to `/docker-compose.yml` (Coolify defaults to `.yaml`).
2. Assign the domain to the `frontend` service, port 4000, and set `SITE_URL` to that exact address. HTTPS is automatic once the domain's DNS A record points at the server.
3. Set the environment variables from `.env.example`: a long random `POSTGRES_PASSWORD`, `SITE_URL`, and `COOKIE_SECURE=true`.
4. Turn on auto-deploy on push.
5. Turn on scheduled backups for the `postgres` service to an S3-compatible bucket off the server. If your Coolify version cannot back up a database inside a compose stack, add a scheduled task that runs `pg_dump -U todo todo | gzip` and uploads the file.

Without Coolify, the same files run on any Docker host: put a reverse proxy with HTTPS in front of `frontend:4000` and run `docker compose up -d --build`.

### Restore a backup

```sh
docker compose stop api frontend
gunzip -c backup.sql.gz | docker compose exec -T postgres psql -U todo -d todo
docker compose start api frontend
```
