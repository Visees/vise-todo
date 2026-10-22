# Todo

Kanban boards with accounts. Angular 22 + Tailwind 4 + Spartan UI + Angular Material dialogs (`frontend/`), Express 5 + Zod + PostgreSQL 17 (`backend/`), Docker Compose for Coolify.

Read these instead of exploring:
- `README.md`: features, tables, API routes, run and deploy. Check the API table before reading route files.
- `DESIGN.md`: the look (Enginy / Edicola admin). Read it before any UI change; use only the tokens in `frontend/src/styles.css`, no `dark:` variants, no hex in classes.

## Where things are

- `backend/src/`: `index.ts` (app, routes mount), one file per area (`auth`, `lists`, `todos`, `columns`, `users`, `admin`), `db.ts`, `config.ts`. Schema in `backend/schema.sql`, idempotent, applied at API start.
- `frontend/src/app/`: `core/` (services, stores, models, icons), `features/` (board, lists, admin, account, login), `layout/` (shell, sidebar, filter menu). `frontend/libs/ui` holds the generated Spartan helm components. `frontend/src/server.ts` serves the app and proxies `/api`.

## Commands

- Check types: `cd backend && npm run typecheck`; `cd frontend && npx ng build`
- Full stack: `docker compose up -d --build`, app on http://localhost:8090, Postgres on `localhost:5436`
- Schema change with only test data: `docker compose down -v`; with real data add `ALTER TABLE … IF NOT EXISTS` to `schema.sql`

## Working cheaply

- Don't read `node_modules`, `dist`, `.angular`, `package-lock.json` or `.playwright-mcp/`.
- Browser checks: measure with `browser_evaluate` first, screenshot only screens that changed or failed (rules in the `ui-design` skill).
- Keep `README.md` and `DESIGN.md` up to date when behaviour or the look changes, so the next session can read them instead of the code.
