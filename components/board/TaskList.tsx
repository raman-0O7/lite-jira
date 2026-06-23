"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { format } from "date-fns";

import { LabelChip } from "@/components/board/LabelChip";
import { TaskCard } from "@/components/board/TaskCard";
import { Badge } from "@/components/ui/badge";
import type { TaskStub } from "@/lib/api/boards";
import {
  dueBadgeClass,
  dueStatus,
  PRIORITY_BADGE_CLASS,
  PRIORITY_LABEL,
} from "@/lib/task-meta";
import { cn } from "@/lib/utils";

/**
 * TaskCardLabels — the `labels` slot: a row of colored label chips.
 * Renders nothing when the task has no labels (so the slot stays empty).
 */
function TaskCardLabels({ task }: { task: TaskStub }) {
  if (task.labels.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {task.labels.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
    </div>
  );
}

/**
 * TaskCardMeta — the `meta` slot: priority badge + (optional) due-date badge.
 * Due date is red when overdue, amber when due within 2 days, muted otherwise.
 */
function TaskCardMeta({ task }: { task: TaskStub }) {
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const status = due ? dueStatus(due) : null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Badge
        variant="secondary"
        className={cn("border-0", PRIORITY_BADGE_CLASS[task.priority])}
      >
        {PRIORITY_LABEL[task.priority]}
      </Badge>
      {due && status ? (
        <Badge
          variant="secondary"
          className={cn("border-0", dueBadgeClass(status))}
        >
          {format(due, "MMM d")}
        </Badge>
      ) : null}
    </div>
  );
}

/**
 * TaskList — the vertical task region for one column.
 *
 * Injected into ColumnContainer's `children` slot (see its slot contract).
 * Wraps the column's cards in a per-column `SortableContext` (vertical) AND
 * registers a column-level droppable keyed `column:<id>` so an empty column —
 * which has no card to drop *onto* — still accepts drops. KanbanBoard's
 * DndContext orchestrates the actual move; this component is presentational.
 *
 * The whole list is the droppable surface so dropping anywhere in the column
 * body (including the gap below the last card) targets this column.
 *
 * F04: fills the TaskCard `labels` / `meta` slots and forwards `onOpenTask`
 * into the card's `onOpen` hook so a non-drag click opens the detail modal.
 */
export function TaskList({
  columnId,
  tasks,
  filtered,
  busy,
  onDeleteTask,
  onOpenTask,
}: {
  columnId: string;
  tasks: TaskStub[];
  /**
   * F05: true when this column has tasks but they're all hidden by the active
   * filter (so the empty state reads "No matching tasks" rather than "No
   * tasks"). The column droppable stays registered regardless, so drops into a
   * filtered-empty column still work.
   */
  filtered?: boolean;
  busy?: boolean;
  /** Delete a task by id. Owned by KanbanBoard's optimistic delete mutation. */
  onDeleteTask: (taskId: string) => void;
  /** Open the detail modal for a task (F04). */
  onOpenTask?: (taskId: string) => void;
}) {
  // Column-level droppable: lets empty columns (and the area past the last
  // card) accept a drop. Prefixed so its id never collides with a task id.
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${columnId}`,
    data: { type: "column", columnId },
  });

  const taskIds = tasks.map((t) => t.id);

  return (
    <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-16 flex-1 flex-col gap-2 rounded-lg transition-colors",
          isOver && "bg-accent/40",
        )}
      >
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            busy={busy}
            onDelete={() => onDeleteTask(task.id)}
            onOpen={onOpenTask ? () => onOpenTask(task.id) : undefined}
            labels={<TaskCardLabels task={task} />}
            meta={<TaskCardMeta task={task} />}
          />
        ))}
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            {filtered ? "No matching tasks" : "No tasks"}
          </p>
        ) : null}
      </div>
    </SortableContext>
  );
}
