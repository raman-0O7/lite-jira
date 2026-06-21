# Feature 02 — Boards & Columns

**Wave 2 · parallel with Feature 01 · depends on 00.**

## Goal
CRUD for boards and their columns. New board seeds default columns. Column
reorder + rename + add + delete. This is the data layer the Kanban view (F03) renders.

## Depends on
- 00: Prisma schema (`Board`, `Column`), `lib/db.ts`, `requireUser()`,
  `lib/validations/{board,column}.ts`, API map.

## Scope — in
**API (route handlers, all scoped to session user, Zod-validated):**
- `GET /api/boards` → user's boards (id, name, counts).
- `POST /api/boards` `{name}` → create board + seed columns
  **To Do / In Progress / Done** (positions 0,1,2).
- `GET /api/boards/[id]` → board with ordered columns (+ task ids/counts for F03).
- `PATCH /api/boards/[id]` `{name}` → rename. `DELETE` → cascade delete.
- `POST /api/boards/[id]/columns` `{name}` → append column at `max(position)+1`.
- `PATCH /api/columns/[id]` `{name}` → rename.
- `DELETE /api/columns/[id]` → delete (block or cascade tasks — **cascade**, warn in UI).
- `PATCH /api/columns/reorder` `{boardId, orderedIds:string[]}` → rewrite positions.

**Ownership guard:** every handler verifies the row's board belongs to session user;
else 404.

**UI:**
- `/boards` (boards list): grid of board cards, "New board" dialog, rename/delete menu.
- Board page `/boards/[id]`: renders columns (header + add/rename/delete column,
  drag-handle for reorder). Task rendering is F03 — expose a slot/placeholder.
- Column reorder via dnd-kit (horizontal). Optimistic update + persist via reorder API.

## Scope — out
Tasks, task drag-drop, labels. Board sharing.

## Files (owns)
```
app/(app)/boards/page.tsx                 # replaces F00 placeholder
app/(app)/boards/[id]/page.tsx            # board shell + columns
app/api/boards/route.ts
app/api/boards/[id]/route.ts
app/api/boards/[id]/columns/route.ts
app/api/columns/[id]/route.ts
app/api/columns/reorder/route.ts
components/board/BoardList.tsx
components/board/BoardCard.tsx
components/board/ColumnHeader.tsx
components/board/ColumnContainer.tsx       # exposes children slot for tasks (F03)
lib/api/boards.ts                          # client fetchers (TanStack Query)
```
Define `ColumnContainer` so F03 can inject the task list + "add task" without
F03 editing F02 files.

## Acceptance criteria
- [ ] Create board → appears in list with 3 seeded columns.
- [ ] Rename/delete board works; delete cascades columns.
- [ ] Add / rename / delete column works.
- [ ] Drag to reorder columns persists across reload.
- [ ] All board/column endpoints reject other users' rows with 404.
- [ ] `pnpm build` + `pnpm lint` clean.
