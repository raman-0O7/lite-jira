# Feature 06 — Foundation v2: workspaces, service layer, activity log

**Wave 5 · runs alone · depends on phase 1 (00–05).** See [`PLAN-v2.md`](../PLAN-v2.md) §3–4.

## Goal
Move ownership from a single user to **workspaces with roles**, and route every
mutation through a **service layer** that authorizes, validates, and records an
**activity** row in the same transaction. This is the base that MCP, the GitHub
App, and agents (features 10–12) build on.

Board/Column/Task/Label keep their names here — the rename to Project/Issue is
Feature 07.

## Scope — in

**Data model**
- `Workspace { id, name, slug (unique), personal, createdAt, updatedAt }`
- `Membership { workspaceId, userId, role OWNER|ADMIN|MEMBER|GUEST }`, unique per pair.
- `Board.userId` → `Board.workspaceId`.
- `Activity { workspaceId, boardId?, taskId?, actorType USER|AGENT|GITHUB|SYSTEM,
  actorUserId?, actorAgentId?, action, data Json, createdAt }`. `boardId`/`taskId`
  are plain ids (no FK) so history survives deletes; `actorAgentId` gets its FK
  when the `Agent` model lands (Feature 12).
- Hand-written migration: every existing user gets a personal workspace (OWNER
  membership) and their boards move into it. No data is lost.

**Service layer** (`lib/services/*`) — the only code that writes app data.
- `Ctx = { actor, workspaceId, role, via }`; `Actor` = user | agent | github | system
  (shape fixed by PLAN-v2 §3).
- `authorize(ctx, action)` from `lib/permissions.ts` (role matrix below).
- `recordActivity(tx, ctx, …)` inside the same `$transaction` as the write.
- Errors are `ServiceError(status, message)`; route handlers map them to
  `{ error }` JSON.
- Services: `workspaces`, `boards`, `columns`, `tasks`, `labels`.

**Workspace resolution** (`lib/api/context.ts`)
- From a slug (`/api/workspaces/[slug]/…`, workspace pages).
- From a resource id (board / column / task / label routes): resolve the owning
  workspace and the caller's membership in one query.
- Non-member or missing resource → **404**. Member lacking the permission → **403**
  (they already know it exists).

**Signup + entry**
- Better Auth `databaseHooks.user.create.after` creates the personal workspace.
- `/boards` (login/signup landing) redirects to the default workspace, creating
  the personal workspace lazily if a user has none.

**Routes & UI**
- Pages: `/[workspace]/boards`, `/[workspace]/boards/[id]`. Legacy `/boards/[id]`
  redirects to the board's workspace URL.
- `app/(app)/[workspace]/layout.tsx` checks membership server-side (`notFound()`
  otherwise) and provides `{ slug, name, role }` to client components.
- API: `GET /api/workspaces` (my workspaces), `GET|POST /api/workspaces/[slug]/boards`
  (replaces `/api/boards`). All other routes keep their paths.
- Top bar shows the current workspace name. Switching/creating workspaces is
  Feature 08.
- Reserved slugs: `api`, `boards`, `login`, `signup`, `settings`, `invite`, `_next`, …

**Tests** — Vitest against a separate database (`task_management_test`).

## Roles

| Action | Owner | Admin | Member | Guest | Agent (cap) |
|--------|:-----:|:-----:|:------:|:-----:|:-----------:|
| `workspace.read`, `board.read` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `board.create`, `board.update`, `column.write`, `task.write`, `label.write` | ✓ | ✓ | ✓ | — | ✓ |
| `board.delete` | ✓ | ✓ | — | — | **never** |
| `members.manage`, `integrations.manage` | ✓ | ✓ | — | — | **never** |
| `workspace.delete` | ✓ | — | — | — | **never** |

An agent's effective permissions = its on-behalf-of user's role ∩ the agent cap.
Per-project guest scoping (`ProjectAccess`) arrives with invites in Feature 08;
until then guests cannot be created.

## Activity actions
`board.created|renamed|deleted`, `column.created|renamed|deleted|reordered`,
`task.created|updated|moved|deleted`, `label.created|updated|deleted`.
`data` carries the changed fields (e.g. `{ from, to }` for moves and renames).

## Scope — out
Project/Issue rename, issue keys, assignees (07). Invites, switcher, guest
project access (08). UI redesign (09). API tokens / MCP (10).

## Files
```
prisma/schema.prisma, prisma/migrations/*_workspaces/migration.sql
lib/permissions.ts
lib/services/{context,errors,activity,workspaces,boards,columns,tasks,labels}.ts
lib/api/context.ts, lib/api/handler.ts      (replaces lib/api/ownership.ts)
lib/auth.ts                                 (signup hook)
app/api/workspaces/route.ts, app/api/workspaces/[slug]/boards/route.ts
app/api/{boards,columns,tasks,labels}/**    (thin over services)
app/(app)/[workspace]/{layout,boards/page,boards/[id]/page}.tsx
app/(app)/boards/page.tsx, app/(app)/boards/[id]/page.tsx (redirects)
components/providers/workspace-provider.tsx
components/board/{BoardList,BoardCard,BoardView}.tsx, components/app-shell/top-bar.tsx
lib/api/boards.ts                           (workspace-scoped fetchers)
vitest.config.ts, tests/**
```

## Acceptance criteria
- [x] Migration on a phase 1 database: every user has a personal workspace, every
      board belongs to its owner's workspace, nothing is lost.
- [x] New signups get a personal workspace; logging in lands on `/{slug}/boards`.
- [x] Every board/column/task/label mutation goes through a service and writes an
      Activity row with the actor in the same transaction.
- [x] A user who is not a member gets 404 for that workspace's pages and every
      resource API; a member without permission gets 403.
- [x] All phase 1 behavior works unchanged inside the workspace URLs.
- [x] `pnpm lint`, `tsc --noEmit`, `pnpm test`, `pnpm build` clean.
