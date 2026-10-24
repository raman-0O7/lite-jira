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
import { useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { AddTaskComposer } from "@/components/board/AddTaskComposer";
import { ColumnContainer } from "@/components/board/ColumnContainer";
import { ColumnHeader } from "@/components/board/ColumnHeader";
import { TaskCard } from "@/components/board/TaskCard";
import { TaskList } from "@/components/board/TaskList";
import { TaskModal } from "@/components/board/TaskModal";
import { Button } from "@/components/ui/button";
import {
  projectKeys,
  type ColumnCategory,
  type ColumnWithIssues,
  type IssueCard,
  type ProjectDetail,
} from "@/lib/api/projects";
import { deleteIssue, moveIssue } from "@/lib/api/issues";
import {
  EMPTY_FILTERS,
  isFiltersEmpty,
  matchesFilters,
  type FilterState,
} from "@/lib/board-filters";
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
  projectId,
  columns,
  columnsBusy,
  filters = EMPTY_FILTERS,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onSetColumnCategory,
  onReorderColumns,
}: {
  projectId: string;
  columns: ColumnWithIssues[];
  columnsBusy?: boolean;
  /**
   * F05: client-side filter state. Applied ONLY to the rendered task lists — a
   * filtered-out card simply isn't rendered. All drag/dnd logic below still
   * operates on the unfiltered `columns`, so filtering never mutates F03's
   * board/task state and never breaks moves.
   */
  filters?: FilterState;
  onAddColumn: () => void;
  onRenameColumn: (id: string, name: string) => void;
  onDeleteColumn: (id: string) => void;
  onSetColumnCategory: (id: string, category: ColumnCategory) => void;
  onReorderColumns: (orderedIds: string[], ordered: ColumnWithIssues[]) => void;
}) {
  const queryClient = useQueryClient();
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  // The issue whose detail modal is open (F04). Opening is triggered by a
  // non-drag click on a card via TaskCard's `onOpen` slot hook, or by an
  // `?issue=WEB-42` link (what /[workspace]/issues/[key] redirects to).
  const searchParams = useSearchParams();
  const [openTaskId, setOpenIssueState] = useState<string | null>(() => {
    const key = searchParams.get("issue")?.toUpperCase();
    if (!key) return null;
    for (const column of columns) {
      const hit = column.issues.find((issue) => issue.key === key);
      if (hit) return hit.id;
    }
    return null;
  });

  /** Open/close the modal and keep `?issue=` in the URL shareable. */
  function setOpenTaskId(issueId: string | null) {
    setOpenIssueState(issueId);
    const key = issueId
      ? columns.flatMap((c) => c.issues).find((issue) => issue.id === issueId)?.key
      : undefined;
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("issue", key);
    else url.searchParams.delete("issue");
    window.history.replaceState(null, "", url);
  }
  // True pre-drag column state, captured at drag start. handleDragOver mutates
  // the cache live, so this is the only faithful rollback target if the move
  // request fails.
  const preDragColumns = useRef<ColumnWithIssues[] | null>(null);

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

  function setColumns(updater: (cols: ColumnWithIssues[]) => ColumnWithIssues[]) {
    queryClient.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (prev) =>
      prev ? { ...prev, columns: updater(prev.columns) } : prev,
    );
  }

  function snapshotColumns(): ColumnWithIssues[] {
    return (
      queryClient.getQueryData<ProjectDetail>(projectKeys.detail(projectId))
        ?.columns ?? []
    );
  }

  function findColumnOfTask(
    cols: ColumnWithIssues[],
    taskId: string,
  ): ColumnWithIssues | undefined {
    return cols.find((c) => c.issues.some((t) => t.id === taskId));
  }

  // ---- task mutations ------------------------------------------------------

  const remove = useMutation({
    mutationFn: (taskId: string) => deleteIssue(taskId),
    onMutate: (taskId) => {
      const previous = snapshotColumns();
      setColumns((cols) =>
        cols.map((c) => ({
          ...c,
          issues: c.issues
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
      previous: ColumnWithIssues[];
    }) =>
      moveIssue({
        issueId: vars.taskId,
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
      let toColumn: ColumnWithIssues | undefined;
      if (overId.startsWith("column:")) {
        const colId = overId.slice("column:".length);
        toColumn = cols.find((c) => c.id === colId);
      } else if (columnIds.includes(overId)) {
        toColumn = cols.find((c) => c.id === overId);
      } else {
        toColumn = findColumnOfTask(cols, overId);
      }
      if (!toColumn || toColumn.id === fromColumn.id) return cols;

      const moving = fromColumn.issues.find((t) => t.id === activeId);
      if (!moving) return cols;

      // Insert at the hovered task's index, else append to the end.
      const overIndex = toColumn.issues.findIndex((t) => t.id === overId);
      const insertAt =
        overIndex === -1 ? toColumn.issues.length : overIndex;

      return cols.map((c) => {
        if (c.id === fromColumn.id) {
          return {
            ...c,
            issues: c.issues
              .filter((t) => t.id !== activeId)
              .map((t, i) => ({ ...t, position: i })),
          };
        }
        if (c.id === toColumn.id) {
          const next = [...c.issues];
          next.splice(insertAt, 0, moving);
          return { ...c, issues: next.map((t, i) => ({ ...t, position: i })) };
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
      toPosition = toColumn.issues.length;
    } else {
      const overIndex = toColumn.issues.findIndex((t) => t.id === overId);
      if (overIndex === -1) {
        toPosition = toColumn.issues.findIndex((t) => t.id === activeId);
      } else {
        // Reorder within the column to land exactly on the hovered slot.
        const fromIndex = toColumn.issues.findIndex((t) => t.id === activeId);
        toPosition = overIndex;
        if (fromIndex !== -1 && fromIndex !== overIndex) {
          const reordered = arrayMove(toColumn.issues, fromIndex, overIndex).map(
            (t, i) => ({ ...t, position: i }),
          );
          setColumns((curr) =>
            curr.map((c) =>
              c.id === toColumn.id ? { ...c, issues: reordered } : c,
            ),
          );
          toPosition = reordered.findIndex((t) => t.id === activeId);
        }
      }
    }
    toPosition = clampPosition(toPosition, toColumn.issues.length);

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

  // F05: derive the visible task list per column WITHOUT touching the cache.
  // When filters are active we run each task through the pure matcher; an empty
  // filter passes everything (and skips the work entirely).
  const filtersActive = !isFiltersEmpty(filters);
  function visibleTasks(column: ColumnWithIssues): IssueCard[] {
    if (!filtersActive) return column.issues;
    return column.issues.filter((task) => matchesFilters(task, filters));
  }

  const overlayColumn = activeColumnId
    ? columns.find((c) => c.id === activeColumnId)
    : null;
  const overlayTask: IssueCard | null = activeTaskId
    ? (columns.flatMap((c) => c.issues).find((t) => t.id === activeTaskId) ??
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
              onSetCategory={(category) => onSetColumnCategory(column.id, category)}
            >
              <TaskList
                columnId={column.id}
                issues={visibleTasks(column)}
                // Distinguish "genuinely empty" from "hidden by a filter" so the
                // per-column empty state reads correctly.
                filtered={filtersActive && column.issues.length > 0}
                busy={remove.isPending}
                onDeleteTask={(taskId) => remove.mutate(taskId)}
                onOpenTask={(taskId) => setOpenTaskId(taskId)}
              />
              <AddTaskComposer columnId={column.id} projectId={projectId} />
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
              taskCount={overlayColumn.issues.length}
              onRename={() => {}}
              onDelete={() => {}}
              onSetCategory={() => {}}
            />
          </div>
        ) : overlayTask ? (
          <div className="w-64 rotate-2">
            <TaskCard task={overlayTask} onDelete={() => {}} />
          </div>
        ) : null}
      </DragOverlay>

      {/*
        Detail modal (F04). Mounted outside the cards so opening it never
        interferes with the dnd sensors: TaskCard's `onOpen` only fires on a
        plain click (the PointerSensor's 6px activation distance keeps a click
        from starting a drag), and the modal renders in a portal.
      */}
      <TaskModal
        projectId={projectId}
        taskId={openTaskId}
        open={openTaskId !== null}
        onOpenChange={(next) => {
          if (!next) setOpenTaskId(null);
        }}
        onDeleted={(taskId) => remove.mutate(taskId)}
        onOpenIssue={(issueId) => setOpenTaskId(issueId)}
      />
    </DndContext>
  );
}
