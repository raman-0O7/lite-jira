"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AddTaskComposer } from "@/components/board/AddTaskComposer";
import { ColumnContainer } from "@/components/board/ColumnContainer";
import { ColumnHeader } from "@/components/board/ColumnHeader";
import { TaskCard } from "@/components/board/TaskCard";
import { TaskList } from "@/components/board/TaskList";
import { Button } from "@/components/ui/button";
import {
  boardKeys,
  type BoardDetail,
  type ColumnWithTasks,
  type TaskStub,
} from "@/lib/api/boards";
import { deleteTask, moveTask } from "@/lib/api/tasks";
import { clampPosition } from "@/lib/board-dnd";

/**
 * KanbanBoard — the single dnd-kit orchestrator for the board body.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * INTEGRATION WITH FEATURE 02'S COLUMN REORDER
 * ───────────────────────────────────────────────────────────────────────────
 * F02 originally hosted its own column-only `DndContext` inside BoardView. Two
 * sibling/nested DndContexts fight over sensors and collision detection, so we
 * UNIFY them: this component owns ONE `DndContext` that handles BOTH:
 *   - column horizontal reorder (active id === a column id), and
 *   - task drag: intra-column reorder + cross-column move (active id === a
 *     task id).
 * We tell them apart by looking the active id up in the columns array. Column
 * drags delegate to `onReorderColumns` (F02's mutation, still owned by
 * BoardView); task drags are handled here against the board-detail cache.
 *
 * BoardView keeps ownership of the board query + column CRUD/reorder mutations
 * and passes them in as props, so F02's column code is reused, not rewritten.
 * ───────────────────────────────────────────────────────────────────────────
 */
export function KanbanBoard({
  boardId,
  columns,
  columnsBusy,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onReorderColumns,
}: {
  boardId: string;
  columns: ColumnWithTasks[];
  columnsBusy?: boolean;
  onAddColumn: () => void;
  onRenameColumn: (id: string, name: string) => void;
  onDeleteColumn: (id: string) => void;
  onReorderColumns: (orderedIds: string[], ordered: ColumnWithTasks[]) => void;
}) {
  const queryClient = useQueryClient();
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  // True pre-drag column state, captured at drag start. handleDragOver mutates
  // the cache live, so this is the only faithful rollback target if the move
  // request fails.
  const preDragColumns = useRef<ColumnWithTasks[] | null>(null);

  const sensors = useSensors(
    // A small activation distance keeps header/menu clicks working without
    // accidentally starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const columnIds = columns.map((c) => c.id);

  // ---- cache helpers -------------------------------------------------------

  function setColumns(updater: (cols: ColumnWithTasks[]) => ColumnWithTasks[]) {
    queryClient.setQueryData<BoardDetail>(boardKeys.detail(boardId), (prev) =>
      prev ? { ...prev, columns: updater(prev.columns) } : prev,
    );
  }

  function snapshotColumns(): ColumnWithTasks[] {
    return (
      queryClient.getQueryData<BoardDetail>(boardKeys.detail(boardId))
        ?.columns ?? []
    );
  }

  function findColumnOfTask(
    cols: ColumnWithTasks[],
    taskId: string,
  ): ColumnWithTasks | undefined {
    return cols.find((c) => c.tasks.some((t) => t.id === taskId));
  }

  // ---- task mutations ------------------------------------------------------

  const remove = useMutation({
    mutationFn: (taskId: string) => deleteTask(taskId),
    onMutate: (taskId) => {
      const previous = snapshotColumns();
      setColumns((cols) =>
        cols.map((c) => ({
          ...c,
          tasks: c.tasks
            .filter((t) => t.id !== taskId)
            .map((t, i) => ({ ...t, position: i })),
        })),
      );
      return { previous };
    },
    onError: (error: Error, _taskId, context) => {
      if (context?.previous) setColumns(() => context.previous);
      toast.error(error.message);
    },
  });

  // The move mutation persists what the optimistic drag already applied; on
  // failure we roll back to the snapshot captured before the optimistic update.
  const move = useMutation({
    mutationFn: (vars: {
      taskId: string;
      toColumnId: string;
      toPosition: number;
      previous: ColumnWithTasks[];
    }) =>
      moveTask({
        taskId: vars.taskId,
        toColumnId: vars.toColumnId,
        toPosition: vars.toPosition,
      }),
    onError: (error: Error, vars) => {
      setColumns(() => vars.previous);
      toast.error(error.message);
    },
  });

  // ---- drag handlers -------------------------------------------------------

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    // Capture the faithful pre-drag arrangement for task-move rollback.
    preDragColumns.current = snapshotColumns();
    if (columnIds.includes(id)) {
      setActiveColumnId(id);
    } else {
      setActiveTaskId(id);
    }
  }

  // While dragging a task, move it between columns live so the placeholder &
  // cross-column transitions feel right. Intra-column ordering settles here too
  // for tasks; the final position is committed in onDragEnd.
  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    if (columnIds.includes(activeId)) return; // column drag — ignore here.

    const overId = String(over.id);

    setColumns((cols) => {
      const fromColumn = findColumnOfTask(cols, activeId);
      if (!fromColumn) return cols;

      // Resolve the destination column: dropping over a task targets that
      // task's column; dropping over a column droppable (`column:<id>`)
      // targets that column directly.
      let toColumn: ColumnWithTasks | undefined;
      if (overId.startsWith("column:")) {
        const colId = overId.slice("column:".length);
        toColumn = cols.find((c) => c.id === colId);
      } else if (columnIds.includes(overId)) {
        toColumn = cols.find((c) => c.id === overId);
      } else {
        toColumn = findColumnOfTask(cols, overId);
      }
      if (!toColumn || toColumn.id === fromColumn.id) return cols;

      const moving = fromColumn.tasks.find((t) => t.id === activeId);
      if (!moving) return cols;

      // Insert at the hovered task's index, else append to the end.
      const overIndex = toColumn.tasks.findIndex((t) => t.id === overId);
      const insertAt =
        overIndex === -1 ? toColumn.tasks.length : overIndex;

      return cols.map((c) => {
        if (c.id === fromColumn.id) {
          return {
            ...c,
            tasks: c.tasks
              .filter((t) => t.id !== activeId)
              .map((t, i) => ({ ...t, position: i })),
          };
        }
        if (c.id === toColumn.id) {
          const next = [...c.tasks];
          next.splice(insertAt, 0, moving);
          return { ...c, tasks: next.map((t, i) => ({ ...t, position: i })) };
        }
        return c;
      });
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeColumn = activeColumnId;
    const activeTask = activeTaskId;
    setActiveColumnId(null);
    setActiveTaskId(null);

    const preDrag = preDragColumns.current;
    preDragColumns.current = null;

    const { active, over } = event;
    if (!over) {
      // Dropped outside any droppable; undo any live cross-column edits.
      if (activeTask && preDrag) setColumns(() => preDrag);
      return;
    }

    const activeId = String(active.id);
    const overId = String(over.id);

    // ---- column reorder (F02) ----
    if (activeColumn) {
      if (activeId === overId || !columnIds.includes(overId)) return;
      const oldIndex = columns.findIndex((c) => c.id === activeId);
      const newIndex = columns.findIndex((c) => c.id === overId);
      if (oldIndex === -1 || newIndex === -1) return;
      const next = arrayMove(columns, oldIndex, newIndex).map((c, i) => ({
        ...c,
        position: i,
      }));
      onReorderColumns(
        next.map((c) => c.id),
        next,
      );
      return;
    }

    // ---- task move ----
    if (!activeTask) return;

    // handleDragOver already moved the card across columns optimistically; here
    // we settle the final index within the resolved column and persist. `cols`
    // is the current (post-drag-over) on-screen state we read the target from.
    const cols = snapshotColumns();
    const toColumn = findColumnOfTask(cols, activeId);
    if (!toColumn) return;

    // Determine the target index within the destination column.
    let toPosition: number;
    if (overId.startsWith("column:")) {
      toPosition = toColumn.tasks.length;
    } else {
      const overIndex = toColumn.tasks.findIndex((t) => t.id === overId);
      if (overIndex === -1) {
        toPosition = toColumn.tasks.findIndex((t) => t.id === activeId);
      } else {
        // Reorder within the column to land exactly on the hovered slot.
        const fromIndex = toColumn.tasks.findIndex((t) => t.id === activeId);
        toPosition = overIndex;
        if (fromIndex !== -1 && fromIndex !== overIndex) {
          const reordered = arrayMove(toColumn.tasks, fromIndex, overIndex).map(
            (t, i) => ({ ...t, position: i }),
          );
          setColumns((curr) =>
            curr.map((c) =>
              c.id === toColumn.id ? { ...c, tasks: reordered } : c,
            ),
          );
          toPosition = reordered.findIndex((t) => t.id === activeId);
        }
      }
    }
    toPosition = clampPosition(toPosition, toColumn.tasks.length);

    move.mutate({
      taskId: activeId,
      toColumnId: toColumn.id,
      toPosition,
      // Roll back to the faithful pre-drag arrangement (captured at drag start)
      // if the persist fails — `cols` already includes this drag's optimistic
      // edits and would not undo them.
      previous: preDrag ?? cols,
    });
  }

  const overlayColumn = activeColumnId
    ? columns.find((c) => c.id === activeColumnId)
    : null;
  const overlayTask: TaskStub | null = activeTaskId
    ? (columns.flatMap((c) => c.tasks).find((t) => t.id === activeTaskId) ??
      null)
    : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={columnIds}
        strategy={horizontalListSortingStrategy}
      >
        <div className="flex h-full min-h-[60vh] items-start gap-4">
          {columns.map((column) => (
            <ColumnContainer
              key={column.id}
              column={column}
              busy={columnsBusy}
              onRename={(name) => onRenameColumn(column.id, name)}
              onDelete={() => onDeleteColumn(column.id)}
            >
              <TaskList
                columnId={column.id}
                tasks={column.tasks}
                busy={remove.isPending}
                onDeleteTask={(taskId) => remove.mutate(taskId)}
              />
              <AddTaskComposer columnId={column.id} boardId={boardId} />
            </ColumnContainer>
          ))}
          {columns.length === 0 ? (
            <div className="flex h-40 w-72 shrink-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
              <p>No columns yet</p>
              <Button variant="outline" size="sm" onClick={onAddColumn}>
                <Plus />
                Add column
              </Button>
            </div>
          ) : null}
        </div>
      </SortableContext>

      <DragOverlay>
        {overlayColumn ? (
          <div className="flex w-72 flex-col rounded-xl border bg-muted/80 shadow-lg">
            <ColumnHeader
              column={overlayColumn}
              taskCount={overlayColumn.tasks.length}
              onRename={() => {}}
              onDelete={() => {}}
            />
          </div>
        ) : overlayTask ? (
          <div className="w-64 rotate-2">
            <TaskCard task={overlayTask} onDelete={() => {}} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
