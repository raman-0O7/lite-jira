# Feature 04 — Task metadata & detail modal

**Wave 4 · parallel with Feature 05 · depends on 03.**

## Goal
Full task editing via a detail modal: description (Markdown), priority, due date,
and labels (create/assign colored tags). Cards show priority/label/due visuals.

## Depends on
- 03: `TaskCard` render slots, `GET/PATCH /api/tasks/[id]`, `TaskList`.
- 00: `Task`, `Label`, `Priority`, validations.

## Scope — in
**API:**
- Extend `PATCH /api/tasks/[id]` to accept `{description, priority, dueDate, labelIds[]}`
  (connect/disconnect labels). Validate with Zod.
- `GET /api/boards/[id]/labels` → board labels.
- `POST /api/boards/[id]/labels` `{name, color}` → create.
- `PATCH /api/labels/[id]` `{name?, color?}`; `DELETE /api/labels/[id]`.
- Ownership guard via board→user.

**UI:**
- `TaskModal` (shadcn `dialog`): opens on card click.
  - Title (inline edit), description (Markdown editor + preview — `react-markdown`
    for render; textarea for edit).
  - Priority `select` (Low/Med/High/Urgent) with color dots.
  - Due date `popover` + `calendar`; clearable.
  - Labels: multi-select from board labels + "create label" (name + color picker);
    assign/unassign on the task.
  - Delete task button.
- `TaskCard` visuals: priority stripe/badge, label chips, due-date badge
  (red if overdue, amber if ≤2 days). Fill the slots F03 exposed.
- All edits optimistic + persisted; toast on error.

## Scope — out
Search/filter (F05). Comments/attachments (never).

## Files (owns)
```
app/api/boards/[id]/labels/route.ts
app/api/labels/[id]/route.ts
components/board/TaskModal.tsx
components/board/PrioritySelect.tsx
components/board/DueDatePicker.tsx
components/board/LabelPicker.tsx
components/board/LabelChip.tsx
lib/api/labels.ts
```
Extend (with care, coordinate): `TaskCard.tsx` slots, `lib/api/tasks.ts` patch shape,
`lib/validations/task.ts`. These are extensions of F03 interfaces — keep additive.

## Acceptance criteria
- [ ] Click card → modal with all fields editable.
- [ ] Description saved + rendered as Markdown.
- [ ] Priority change reflects on card (color) and persists.
- [ ] Due date set/clear; overdue highlighted on card.
- [ ] Create label, assign to task, chip shows on card; unassign works.
- [ ] Delete from modal removes card.
- [ ] `pnpm build` + `pnpm lint` clean.
