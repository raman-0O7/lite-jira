"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { BoardCard } from "@/components/board/BoardCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { boardKeys, createBoard, fetchBoards } from "@/lib/api/boards";

export function BoardList() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  const boardsQuery = useQuery({
    queryKey: boardKeys.lists(),
    queryFn: fetchBoards,
  });

  const create = useMutation({
    mutationFn: (value: string) => createBoard(value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
      setCreateOpen(false);
      setName("");
      toast.success("Board created.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    create.mutate(trimmed);
  }

  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Boards</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus />
              New board
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create board</DialogTitle>
              <DialogDescription>
                A new board starts with To Do, In Progress, and Done columns.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-board-name">Name</Label>
                <Input
                  id="new-board-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. Product roadmap"
                  disabled={create.isPending}
                  autoFocus
                  maxLength={100}
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreateOpen(false)}
                  disabled={create.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {boardsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading boards…</p>
      ) : boardsQuery.isError ? (
        <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <p className="text-sm text-destructive">
            {(boardsQuery.error as Error).message}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => boardsQuery.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : boardsQuery.data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed py-16 text-center">
          <p className="font-medium">No boards yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create your first board to start organizing work into columns and
            tasks.
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus />
            New board
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {boardsQuery.data.map((board) => (
            <BoardCard key={board.id} board={board} />
          ))}
        </div>
      )}
    </main>
  );
}
