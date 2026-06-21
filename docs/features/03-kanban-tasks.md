# Feature 03 — Kanban & Tasks

**Wave 3 · depends on 01 + 02 · the core feature.**

## Goal
The drag-and-drop Kanban experience: task cards inside columns, create/delete
tasks, drag to reorder within a column and move across columns, persisted.

## Depends on
- 02: `ColumnContainer` slot, board page, `GET /api/boards/[id]` shape.
- 00: `Task` model, `lib/validations/task.ts`, API map.
- dnd-kit installed (00 or here — declare in package.json).

## Scope — in
**API:**
- `POST /api/columns/[id]/tasks` `{title}` → create at `max(position)+1` in column.
- `GET /api/tasks/[id]` → full task (used by F04 modal too).
- `PATCH /api/tasks/[id]` `{title?, ...}` → update (F04 extends fields).
- `DELETE /api/tasks/[id]`.
- `PATCH /api/tasks/move` `{taskId, toColumnId, toPosition}` → reposition within/across
  columns; reindex affected column(s). **Authoritative positioning algorithm:**
  - Fetch sibling tasks in target column ordered by position.
  - Remove task from source list, insert into target at `toPosition`.
  - Reassign `position = index` for affected column(s) in one transaction.
  - All under ownership guard (task → column → board → user).

**UI (dnd-kit):**
- `TaskCard` — title + (placeholder badges for priority/labels/due that F04 fills).
- Render task lists inside F02's `ColumnContainer` slot.
- `DndContext` + `SortableContext` per column; support intra-column reorder and
  cross-column move. Use drag overlay for smooth UX.
- Optimistic reorder; on drop call `/api/tasks/move`; rollback + toast on error.
- "Add task" inline composer at column bottom (title only → opens modal later).
- Delete task (card menu) with confirm.

## Scope — out
Task detail fields beyond title (F04). Filtering (F05).

## Files (owns)
```
app/api/columns/[id]/tasks/route.ts
app/api/tasks/[id]/route.ts
app/api/tasks/move/route.ts
components/board/KanbanBoard.tsx       # DndContext orchestrator
components/board/TaskCard.tsx
components/board/AddTaskComposer.tsx
components/board/TaskList.tsx          # SortableContext, injected into ColumnContainer
lib/api/tasks.ts                       # client fetchers + move mutation
lib/board-dnd.ts                       # position/move helpers (shared w/ tests)
```
`TaskCard` must expose a render surface (slots/props) so F04 can add
priority/label/due visuals without rewriting it.

## Position strategy
Integer `position`, contiguous per column (0..n-1). Server reindexes on every move
inside a transaction — simple, correct for solo scale. Document gap/float option as
future optimization, not needed now.

## Acceptance criteria
- [ ] Add task to a column; appears at bottom.
- [ ] Drag task to reorder within column → order persists on reload.
- [ ] Drag task to another column at a chosen position → persists.
- [ ] Delete task works.
- [ ] Move endpoint rejects tasks not owned by user (404).
- [ ] No position collisions after repeated moves (verify ordering stable).
- [ ] `pnpm build` + `pnpm lint` clean.
