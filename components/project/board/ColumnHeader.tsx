"use client";

import type { useSortable } from "@dnd-kit/sortable";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { StatusIcon } from "@/components/icons/StatusIcon";
import { useCan } from "@/components/providers/workspace-provider";
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ColumnCategory } from "@/lib/api/projects";
import { CATEGORY_LABEL, type StatusVariant, variantForCategory } from "@/lib/status";
import { cn } from "@/lib/utils";

const CATEGORIES: ColumnCategory[] = ["TODO", "IN_PROGRESS", "DONE"];

type ColumnHeaderProps = {
  column: { id: string; name: string; category: ColumnCategory };
  variant: StatusVariant;
  taskCount: number;
  /** Whether mutations are in flight (disables controls). */
  busy?: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  /** Change what the column means (to do / in progress / done). */
  onSetCategory: (category: ColumnCategory) => void;
  /** Open the new-issue dialog with this column as the status. */
  onAddIssue?: () => void;
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
  variant,
  taskCount,
  busy,
  onRename,
  onDelete,
  onSetCategory,
  onAddIssue,
  dragHandleProps,
}: ColumnHeaderProps) {
  const canEdit = useCan("column.write");
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
      <div className="flex h-7 shrink-0 items-center gap-1 px-1">
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2 rounded-md py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            canEdit && "cursor-grab touch-none active:cursor-grabbing",
          )}
          {...(canEdit ? dragHandleProps?.attributes : {})}
          {...(canEdit ? dragHandleProps?.listeners : {})}
          aria-label={canEdit ? `${column.name}: drag to reorder column` : undefined}
          aria-roledescription={canEdit ? "sortable column" : undefined}
        >
          <StatusIcon variant={variant} label={CATEGORY_LABEL[column.category]} />
          <h2 className="truncate text-sm font-semibold text-foreground">{column.name}</h2>
          <span className="text-xs text-muted-foreground tabular">{taskCount}</span>
        </div>

        {canEdit && onAddIssue ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`Add issue to ${column.name}`}
            onClick={onAddIssue}
            className="text-muted-foreground"
          >
            <Plus className="size-3.5" />
          </Button>
        ) : null}
        {canEdit ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`${column.name} column actions`}
                disabled={busy}
                className="text-muted-foreground"
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Category
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={column.category}
                onValueChange={(value) => onSetCategory(value as ColumnCategory)}
              >
                {CATEGORIES.map((category) => (
                  <DropdownMenuRadioItem key={category} value={category}>
                    <StatusIcon variant={variantForCategory(category)} />
                    {CATEGORY_LABEL[category]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
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
        ) : null}
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
                    taskCount === 1 ? "issue" : "issues"
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
