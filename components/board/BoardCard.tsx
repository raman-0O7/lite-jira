"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Layers, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { useWorkspace } from "@/components/providers/workspace-provider";
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
  projectKeys,
  deleteProject,
  renameProject,
  type ProjectSummary,
} from "@/lib/api/projects";

export function BoardCard({ project: board }: { project: ProjectSummary }) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(board.name);

  const rename = useMutation({
    mutationFn: (value: string) => renameProject(board.id, value),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists(slug) });
      setRenameOpen(false);
      toast.success("Project renamed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: () => deleteProject(board.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists(slug) });
      setDeleteOpen(false);
      toast.success("Project deleted.");
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
          href={`/${slug}/projects/${board.key}`}
          className="flex flex-1 flex-col gap-1 outline-none"
        >
          <span className="flex min-w-0 items-center gap-2 pr-8">
            <span className="shrink-0 rounded bg-muted px-1.5 font-mono text-xs text-muted-foreground">
              {board.key}
            </span>
            <span className="truncate font-medium">{board.name}</span>
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Layers className="size-3.5" />
            {board.issueCount} {board.issueCount === 1 ? "issue" : "issues"} ·{" "}
            {board.columnCount} {board.columnCount === 1 ? "column" : "columns"}
          </span>
        </Link>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute right-2 top-2"
              aria-label="Project actions"
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
            <DialogTitle>Rename project</DialogTitle>
            <DialogDescription>
              Give this project a new name. Its key stays {board.key}.
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
              <Button type="submit" loading={rename.isPending} loadingText="Saving…">
                Save
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
              This permanently deletes {board.key} and all of its columns and
              issues. This cannot be undone.
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
              loading={remove.isPending}
              loadingText="Deleting…"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
