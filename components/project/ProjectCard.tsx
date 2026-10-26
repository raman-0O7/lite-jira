"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ProjectTile } from "@/components/icons/ProjectTile";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
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

/** A row on the projects page: tile, name, key, counts, and a rename/delete menu. */
export function ProjectCard({ project: board }: { project: ProjectSummary }) {
  const { slug } = useWorkspace();
  const canRename = useCan("project.update");
  const canDelete = useCan("project.delete");
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
      <li className="group relative flex h-12 items-center border-b hover:bg-accent/50">
        <Link
          href={`/${slug}/projects/${board.key}`}
          className="flex h-full min-w-0 flex-1 items-center gap-3 px-4 outline-none focus-visible:bg-accent md:px-5"
        >
          <ProjectTile projectKey={board.key} name={board.name} size="md" />
          <span className="truncate text-sm font-medium text-foreground">{board.name}</span>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">{board.key}</span>
          <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground tabular sm:inline">
            {board.issueCount} {board.issueCount === 1 ? "issue" : "issues"}
          </span>
          <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:inline">
            {formatDistanceToNowStrict(new Date(board.updatedAt), { addSuffix: true })}
          </span>
          <span className={canRename ? "w-7 shrink-0" : "hidden"} aria-hidden="true" />
        </Link>

        {canRename ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-3 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100 md:right-4"
                aria-label={`Actions for ${board.name}`}
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
              {canDelete ? (
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </li>

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
