"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { FilterBar } from "@/components/board/FilterBar";
import { KanbanBoard } from "@/components/board/KanbanBoard";
import { Button } from "@/components/ui/button";
import { useBoardFilters } from "@/hooks/use-board-filters";
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
  type LabelStub,
} from "@/lib/api/boards";

/**
 * Collect the unique labels in use across a board's tasks (deduped by id,
 * sorted by name) — the option set for F05's label filter.
 */
function deriveLabels(columns: ColumnWithTasks[]): LabelStub[] {
  const seen = new Map<string, LabelStub>();
  for (const column of columns) {
    for (const task of column.tasks) {
      for (const label of task.labels) {
        if (!seen.has(label.id)) seen.set(label.id, label);
      }
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function BoardView({ boardId }: { boardId: string }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");

  // F05: filter state lives in the URL via this hook. It's shared with the
  // FilterBar (drives the controls) and KanbanBoard (derives the filtered view),
  // so both read one source of truth without fighting over board/task state.
  const filters = useBoardFilters();

  const boardQuery = useQuery({
    queryKey: boardKeys.detail(boardId),
    queryFn: () => fetchBoard(boardId),
  });

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

  // KanbanBoard owns the unified DndContext and computes the new column order
  // (arrayMove); BoardView keeps ownership of the reorder mutation. onMutate
  // applies the optimistic update + snapshots for rollback.
  function handleReorderColumns(
    orderedIds: string[],
    ordered: ColumnWithTasks[],
  ) {
    reorder.mutate({ orderedIds, ordered });
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

  // Derive the board's label set from the loaded tasks (deduped by id), so the
  // label filter offers exactly the labels in use. No extra round-trip.
  const boardLabels = deriveLabels(board.columns);

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

      {/* F05: search + filter bar. Filters are client-side over loaded data. */}
      <div className="border-b px-4 py-2.5 sm:px-6">
        <FilterBar labels={boardLabels} filters={filters} />
      </div>

      <div className="flex-1 overflow-x-auto p-4">
        {/*
          KanbanBoard hosts the single unified DndContext for BOTH column
          reorder (F02) and task drag (F03). BoardView keeps the board query +
          column CRUD/reorder mutations and passes the handlers down, so F02's
          column logic is reused rather than rewritten.
        */}
        <KanbanBoard
          boardId={boardId}
          columns={board.columns}
          columnsBusy={rename.isPending || remove.isPending}
          filters={filters.filters}
          onAddColumn={() => setAddOpen(true)}
          onRenameColumn={(id, name) => rename.mutate({ id, name })}
          onDeleteColumn={(id) => remove.mutate(id)}
          onReorderColumns={handleReorderColumns}
        />
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
