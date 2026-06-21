# Feature 05 — Search & filter

**Wave 4 · parallel with Feature 04 · depends on 03 (reads 04 metadata when present).**

## Goal
Filter the active board's cards by free-text, priority, label, and due-date state.
Client-side over already-loaded board data — instant, no extra round-trips.

## Depends on
- 03: board renders tasks; `KanbanBoard` task state.
- 04 (soft): priority/label/due exist on tasks. Build to degrade gracefully if a
  metadata field is absent — filter only on what's present.

## Scope — in
- Filter bar above the board:
  - **Text** input → matches task title + description (case-insensitive, debounced).
  - **Priority** multi-select.
  - **Label** multi-select (from board labels).
  - **Due** quick filters: Overdue · Due this week · No due date.
  - "Clear filters" + active-filter count badge.
- Filtering is **client-side**: derive visible tasks from the loaded board state;
  columns keep structure, hidden cards removed from their lists.
- Empty-state per column when filtered to zero.
- Persist active filters in URL query params (shareable, survives reload).

## Scope — out
Server-side search, saved filters, cross-board search.

## Files (owns)
```
components/board/FilterBar.tsx
components/board/filters/{TextFilter,PriorityFilter,LabelFilter,DueFilter}.tsx
lib/board-filters.ts        # pure predicate fns + URL <-> state (unit-testable)
hooks/use-board-filters.ts  # reads/writes URL params, exposes filter state
```
Consumes board/task state from F03; must not mutate it — derive a filtered view.
Coordinate one integration point in `KanbanBoard.tsx`: apply the filtered task
list. Keep that hook-based so F03/F05 don't fight over the file.

## Acceptance criteria
- [ ] Typing text hides non-matching cards live.
- [ ] Priority/label/due filters combine (AND across types, OR within a type).
- [ ] Filters reflected in URL; reload restores them.
- [ ] Clear resets all; count badge accurate.
- [ ] Drag-drop still works on the unfiltered set; no crashes when a column empties.
- [ ] `pnpm build` + `pnpm lint` clean.
