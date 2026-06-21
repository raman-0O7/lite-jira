"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ColumnContainer } from "@/components/board/ColumnContainer";
import { ColumnHeader } from "@/components/board/ColumnHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  boardKeys,
  createColumn,
  deleteColumn,
  fetchBoard,
  renameColumn,
  reorderColumns,
  type BoardDetail,
  type ColumnWithTasks,
} from "@/lib/api/boards";

export function BoardView({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");

  const boardQuery = useQuery({
    queryKey: boardKeys.detail(boardId),
    queryFn: () => fetchBoard(boardId),
  });

  const sensors = useSensors(
    // A small activation distance lets header clicks (rename/delete) still work
    // without accidentally starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Helper to mutate the cached board's columns array.
  function patchColumns(
    updater: (columns: ColumnWithTasks[]) => ColumnWithTasks[],
  ) {
    queryClient.setQueryData<BoardDetail>(boardKeys.detail(boardId), (prev) =>
      prev ? { ...prev, columns: updater(prev.columns) } : prev,
    );
  }

  const addColumn = useMutation({
    mutationFn: (name: string) => createColumn(boardId, name),
    onSuccess: (column) => {
      patchColumns((columns) => [...columns, column]);
      setAddOpen(false);
      setNewColumnName("");
      toast.success("Column added.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameColumn(id, name),
    onSuccess: (updated) => {
      patchColumns((columns) =>
        columns.map((c) =>
          c.id === updated.id ? { ...c, name: updated.name } : c,
        ),
      );
      toast.success("Column renamed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteColumn(id),
    onSuccess: (_data, id) => {
      patchColumns((columns) => columns.filter((c) => c.id !== id));
      toast.success("Column deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Reorder persists in the background. The cache is updated optimistically in
  // onMutate (so the move feels instant) and rolled back from the snapshot in
  // onError if the request fails.
  const reorder = useMutation({
    mutationFn: ({
      orderedIds,
    }: {
      orderedIds: string[];
      ordered: ColumnWithTasks[];
    }) => reorderColumns(boardId, orderedIds),
    onMutate: ({ ordered }) => {
      const previous =
        queryClient.getQueryData<BoardDetail>(boardKeys.detail(boardId))
          ?.columns ?? [];
      patchColumns(() => ordered);
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) {
        patchColumns(() => context.previous);
      }
      toast.error(error.message);
    },
  });

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const columns = boardQuery.data?.columns ?? [];
    const oldIndex = columns.findIndex((c) => c.id === active.id);
    const newIndex = columns.findIndex((c) => c.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const next = arrayMove(columns, oldIndex, newIndex).map((c, i) => ({
      ...c,
      position: i,
    }));

    // onMutate applies the optimistic update + snapshots for rollback.
    reorder.mutate({ orderedIds: next.map((c) => c.id), ordered: next });
  }

  function handleAddColumn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newColumnName.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    addColumn.mutate(trimmed);
  }

  if (boardQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        Loading board…
      </div>
    );
  }

  if (boardQuery.isError) {
    const message = (boardQuery.error as Error).message;
    const notFound = message.toLowerCase().includes("not found");
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {notFound ? "This board doesn’t exist." : message}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/boards">
            <ArrowLeft />
            Back to boards
          </Link>
        </Button>
      </div>
    );
  }

  const board = boardQuery.data;
  const columnIds = board.columns.map((c) => c.id);
  const activeColumn = board.columns.find((c) => c.id === activeId) ?? null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm" aria-label="Back">
            <Link href="/boards">
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="truncate text-lg font-semibold tracking-tight">
            {board.name}
          </h1>
        </div>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus />
          Add column
        </Button>
      </div>

      <div className="flex-1 overflow-x-auto p-4">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={columnIds}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex h-full min-h-[60vh] items-start gap-4">
              {board.columns.map((column) => (
                <ColumnContainer
                  key={column.id}
                  column={column}
                  busy={rename.isPending || remove.isPending}
                  onRename={(name) => rename.mutate({ id: column.id, name })}
                  onDelete={() => remove.mutate(column.id)}
                />
              ))}
              {board.columns.length === 0 ? (
                <div className="flex h-40 w-72 shrink-0 flex-col items-center justify-center gap-3 rounded-xl border border-dashed text-center text-sm text-muted-foreground">
                  <p>No columns yet</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setAddOpen(true)}
                  >
                    <Plus />
                    Add column
                  </Button>
                </div>
              ) : null}
            </div>
          </SortableContext>

          <DragOverlay>
            {activeColumn ? (
              <div className="flex w-72 flex-col rounded-xl border bg-muted/80 shadow-lg">
                <ColumnHeader
                  column={activeColumn}
                  taskCount={activeColumn.tasks.length}
                  onRename={() => {}}
                  onDelete={() => {}}
                />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Add column dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add column</DialogTitle>
            <DialogDescription>
              Adds a new column to the end of this board.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddColumn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-column-name">Name</Label>
              <Input
                id="new-column-name"
                value={newColumnName}
                onChange={(event) => setNewColumnName(event.target.value)}
                placeholder="e.g. Review"
                disabled={addColumn.isPending}
                autoFocus
                maxLength={100}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddOpen(false)}
                disabled={addColumn.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={addColumn.isPending}>
                {addColumn.isPending ? "Adding…" : "Add"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
