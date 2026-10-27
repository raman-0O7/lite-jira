# Lite Jira — Task Management System · Master Plan

> **Phase 1 (features 00–05) is complete.** Phase 2 — teams, GitHub App, MCP and
> AI agents — is planned in [`PLAN-v2.md`](PLAN-v2.md).

A solo, self-hosted Kanban task manager. Multiple boards, customizable columns,
drag-and-drop tasks, auth. Built so each **feature** below can be handed to a
separate sub-agent.

---

## 1. Product summary

| Aspect | Decision |
|--------|----------|
| Users | Solo (single account model; auth still required) |
| Core UI | Kanban board, drag-and-drop cards |
| Boards | Multiple, user-owned |
| Columns | Customizable per board (rename / add / delete / reorder) |
| Tasks | title, description (Markdown), priority, due date, labels, position |
| Extras | Task detail modal, search + filter |
| Out of scope | comments, attachments, subtasks, activity log, roles, sharing, deploy |

## 2. Tech stack

- **Next.js** (App Router) + **TypeScript** + React
- **Postgres** via local **docker-compose**
- **Prisma** ORM
- **Better Auth** (email/password + GitHub OAuth, Prisma adapter)
- **Tailwind CSS** + **shadcn/ui**
- **dnd-kit** for drag-and-drop
- **Zod** for input validation, **TanStack Query** for client data fetching/cache

## 3. Architecture

```
app/
  (auth)/login, signup           # public pages
  (app)/boards, boards/[id]      # protected pages (Kanban)
  api/auth/[...all]/route.ts     # Better Auth handler
  api/boards, api/columns,       # REST route handlers
      api/tasks, api/labels
lib/
  auth.ts        # Better Auth server instance
  auth-client.ts # Better Auth react client
  db.ts          # Prisma singleton
  validations/   # Zod schemas (shared contracts)
components/
  ui/            # shadcn primitives
  board/         # Kanban, Column, TaskCard, TaskModal, Filters
prisma/
  schema.prisma
docker-compose.yml
```

All app data access goes through Prisma. All mutations validated with Zod.
Every protected route + API handler checks the Better Auth session and scopes
queries to the current `userId`.

## 4. Shared contracts (defined in Feature 00 — do NOT diverge)

- **Prisma schema** — the single source of truth for the data model.
- **API route shapes** — see each feature; foundation publishes the full list in
  `docs/features/00-foundation.md` §API map.
- **Zod schemas** in `lib/validations/*` — imported by both API handlers and forms.
- **Auth helper** `getSession()` / `requireUser()` in `lib/auth.ts`.

Parallel agents import these; they must not redefine the model or route paths.

## 5. Features & execution waves

Dependencies force ordering. Within a wave, features touch mostly disjoint files
and can run in parallel.

| Wave | Feature | File | Depends on |
|------|---------|------|-----------|
| 1 | **00 — Foundation** (scaffold, docker, Prisma schema, Better Auth core, shared contracts) | `features/00-foundation.md` | — |
| 2 | **01 — Auth flows & UI** (signup/login/logout, GitHub OAuth, route protection) | `features/01-auth.md` | 00 |
| 2 | **02 — Boards & Columns** (CRUD + column reorder) | `features/02-boards-columns.md` | 00 |
| 3 | **03 — Kanban & Tasks** (board view, dnd-kit drag-drop, task CRUD) | `features/03-kanban-tasks.md` | 01, 02 |
| 4 | **04 — Task metadata** (detail modal: description, priority, due date, labels) | `features/04-task-metadata.md` | 03 |
| 4 | **05 — Search & filter** (text + priority + label + due filters) | `features/05-search-filter.md` | 03 |

```
Wave 1:  [00 Foundation]
              │
Wave 2:  [01 Auth] ‖ [02 Boards/Columns]
              │            │
Wave 3:        [03 Kanban & Tasks]
              │            │
Wave 4:  [04 Metadata] ‖ [05 Search/Filter]
```

## 6. Sub-agent execution protocol

1. Run Feature 00 **alone** first — it creates the repo, schema, and contracts
   everyone else imports.
2. After 00 lands + `prisma migrate` succeeds, dispatch each later wave.
3. Give each sub-agent: its feature file + `PLAN.md` §3–4 + the committed schema.
4. Each agent owns the files listed under its **Files** section. Shared files
   (`schema.prisma`, `lib/db.ts`, root layout) are **edit-only by Feature 00**;
   later features that need schema changes must be noted, not silently edited.
5. Definition of done per feature = its **Acceptance criteria** all pass +
   `pnpm build` and `pnpm lint` clean.

## 7. Conventions

- Package manager: **pnpm**. Node 20+.
- All IDs server-generated (`cuid()` for app rows; Better Auth manages its own).
- Positions: integer `position`, gap strategy (insert at `max+1`, reindex on
  reorder). Document in Feature 03.
- Errors: API returns `{ error: string }` + proper HTTP status. Client surfaces
  via toast (shadcn `sonner`).
- Env vars in `.env` (gitignored) + `.env.example` committed.
