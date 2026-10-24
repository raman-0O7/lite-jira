"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { ColumnHeader } from "@/components/board/ColumnHeader";
import type { ColumnCategory, ColumnWithIssues } from "@/lib/api/projects";

/**
 * ColumnContainer — the column shell for the board view.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SLOT CONTRACT FOR FEATURE 03 (Kanban & Tasks)
 * ───────────────────────────────────────────────────────────────────────────
 * F02 owns the column *shell*: the drag-handle, header, rename/delete controls,
 * column-level dnd-kit sortable wiring, and the fixed-width scroll layout.
 *
 * F02 does NOT render tasks. The body of the column is an empty slot exposed
 * via the `children` prop. F03 injects its task list + "add task" composer
 * there WITHOUT editing this file:
 *
 *     <ColumnContainer column={col}, onRename={...} onDelete={...} busy={...}>
 *       <TaskList columnId={col.id} tasks={col.issues} />
 *       <AddTaskComposer columnId={col.id} />
 *     </ColumnContainer>
 *
 * Contract details F03 can rely on:
 *  - `column` carries `{ id, name, position, tasks }` (see ColumnWithIssues).
 *    F03 may read `column.issues` for initial render; live task state is F03's.
 *  - `children` renders inside a vertical flex region that grows and scrolls
 *    independently (`flex-1 overflow-y-auto`). The "add task" composer can sit
 *    at the bottom of that region or be rendered after the scroll area —
 *    either way it lives inside `children`.
 *  - When `children` is omitted, F02 renders a neutral placeholder so the
 *    column reads correctly before F03 lands. F03 simply passes children to
 *    replace it.
 *  - The drop target for task drag-and-drop is F03's concern; it should wrap
 *    its own task list in a droppable. This container only makes the COLUMN
 *    itself sortable (horizontal reorder).
 *  - Header task count comes from `column.issues.length`. If F03 manages task
 *    state outside this prop, it can ignore the badge or (future) lift count.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function ColumnContainer({
  column,
  busy,
  onRename,
  onDelete,
  onSetCategory,
  children,
}: {
  column: ColumnWithIssues;
  busy?: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSetCategory: (category: ColumnCategory) => void;
  /** F03 task list + composer slot. See contract above. */
  children?: React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // While dragging, fade the source column; the DragOverlay shows the moving copy.
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex h-full w-72 shrink-0 flex-col rounded-xl border bg-muted/40"
    >
      <ColumnHeader
        column={column}
        taskCount={column.issues.length}
        busy={busy}
        onRename={onRename}
        onDelete={onDelete}
        onSetCategory={onSetCategory}
        dragHandleProps={{ attributes, listeners }}
      />

      {/* Task slot — F03 injects its task list + composer here. */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2 pt-0">
        {children ?? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed py-8 text-center text-xs text-muted-foreground">
            Tasks coming in Feature 03
          </div>
        )}
      </div>
    </div>
  );
}
