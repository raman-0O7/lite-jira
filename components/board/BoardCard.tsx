"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  boardKeys,
  deleteBoard,
  renameBoard,
  type BoardSummary,
} from "@/lib/api/boards";

export function BoardCard({ board }: { board: BoardSummary }) {
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(board.name);

  const rename = useMutation({
    mutationFn: (value: string) => renameBoard(board.id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
      setRenameOpen(false);
      toast.success("Board renamed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteBoard(board.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: boardKeys.lists() });
      setDeleteOpen(false);
      toast.success("Board deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    rename.mutate(trimmed);
  }

  return (
    <>
      <div className="group relative flex flex-col rounded-xl border bg-card p-4 transition-colors hover:border-foreground/20">
        <Link
          href={`/boards/${board.id}`}
          className="flex flex-1 flex-col gap-1 outline-none"
        >
          <span className="truncate pr-8 font-medium">{board.name}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Layers className="size-3.5" />
            {board.columnCount} {board.columnCount === 1 ? "column" : "columns"}
          </span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-2 top-2"
              aria-label="Board actions"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onSelect={() => {
                setName(board.name);
                setRenameOpen(true);
              }}
            >
              <Pencil />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setDeleteOpen(true)}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Rename dialog */}
      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename board</DialogTitle>
            <DialogDescription>
              Give this board a new name.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`rename-board-${board.id}`}>Name</Label>
              <Input
                id={`rename-board-${board.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={rename.isPending}
                autoFocus
                maxLength={100}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={rename.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={rename.isPending}>
                {rename.isPending ? "Saving…" : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{board.name}”?</DialogTitle>
            <DialogDescription>
              This permanently deletes the board and all of its columns and
              tasks. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={remove.isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
