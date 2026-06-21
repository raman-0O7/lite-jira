"use client";

import type { useSortable } from "@dnd-kit/sortable";
import { GripVertical, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
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

type ColumnHeaderProps = {
  column: { id: string; name: string };
  taskCount: number;
  /** Whether mutations are in flight (disables controls). */
  busy?: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  /**
   * dnd-kit drag-handle wiring, spread onto the grip button. The types are
   * derived from `useSortable()`'s return so we don't depend on dnd-kit's
   * internal type export paths.
   */
  dragHandleProps?: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
  };
};

export function ColumnHeader({
  column,
  taskCount,
  busy,
  onRename,
  onDelete,
  dragHandleProps,
}: ColumnHeaderProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [name, setName] = useState(column.name);

  function handleRename(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    onRename(trimmed);
    setRenameOpen(false);
  }

  return (
    <>
      <div className="flex items-center gap-1.5 px-1 py-1">
        <button
          type="button"
          aria-label="Drag to reorder column"
          className="-ml-1 flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
          {...dragHandleProps?.attributes}
          {...dragHandleProps?.listeners}
        >
          <GripVertical className="size-4" />
        </button>

        <span className="flex-1 truncate text-sm font-medium">
          {column.name}
        </span>
        <span className="shrink-0 rounded-md bg-muted px-1.5 text-xs text-muted-foreground">
          {taskCount}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Column actions"
              disabled={busy}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              onSelect={() => {
                setName(column.name);
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
            <DialogTitle>Rename column</DialogTitle>
            <DialogDescription>Give this column a new name.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRename} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`rename-column-${column.id}`}>Name</Label>
              <Input
                id={`rename-column-${column.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
                maxLength={100}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation — warns that tasks are also removed. */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{column.name}”?</DialogTitle>
            <DialogDescription>
              {taskCount > 0
                ? `This deletes the column and its ${taskCount} ${
                    taskCount === 1 ? "task" : "tasks"
                  }. This cannot be undone.`
                : "This deletes the column. This cannot be undone."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDeleteOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onDelete();
                setDeleteOpen(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
