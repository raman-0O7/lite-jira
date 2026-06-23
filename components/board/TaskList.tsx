"use client";

import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { TaskCard } from "@/components/board/TaskCard";
import type { TaskStub } from "@/lib/api/boards";
import { cn } from "@/lib/utils";

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
 */
export function TaskList({
  columnId,
  tasks,
  busy,
  onDeleteTask,
}: {
  columnId: string;
  tasks: TaskStub[];
  busy?: boolean;
  /** Delete a task by id. Owned by KanbanBoard's optimistic delete mutation. */
  onDeleteTask: (taskId: string) => void;
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
          />
        ))}
        {tasks.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-muted-foreground">
            No tasks
          </p>
        ) : null}
      </div>
    </SortableContext>
  );
}
