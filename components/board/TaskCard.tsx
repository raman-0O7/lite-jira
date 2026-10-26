"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";

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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { IssueCard } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

/**
 * TaskCard — a single draggable task card.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * SLOT CONTRACT FOR FEATURE 04 (Task metadata)
 * ───────────────────────────────────────────────────────────────────────────
 * F03 owns the card *shell*: the dnd-kit sortable wiring, the drag affordance,
 * the title, and the delete menu. F03 renders ONLY the title.
 *
 * F04 adds priority / label / due-date visuals WITHOUT rewriting this file by
 * passing render slots:
 *
 *   - `meta`   → rendered under the title (e.g. priority badge, due date).
 *   - `labels` → rendered above the title (e.g. a row of color label chips).
 *   - `onOpen` → invoked on a plain click of the card body (not a drag),
 *                so F04 can open its detail modal. Drag is initiated from the
 *                whole card; `onOpen` only fires when the pointer didn't drag.
 *
 * Anything passed via these slots sits inside the same card frame, so F04 never
 * touches layout/drag code. If a slot is omitted, nothing extra renders.
 *
 * `task` is a IssueCard ({ id, title, position, priority, dueDate }); F04 can
 * read `priority` / `dueDate` straight off it to render its badges.
 * ───────────────────────────────────────────────────────────────────────────
 */
export type TaskCardProps = {
  task: IssueCard;
  /** Disable controls while a mutation touching this card is in flight. */
  busy?: boolean;
  onDelete: () => void;
  /** F04 slot: row above the title (label chips). */
  labels?: React.ReactNode;
  /** F04 slot: row below the title (priority badge, due date…). */
  meta?: React.ReactNode;
  /** F04 hook: open the detail modal on a non-drag click. */
  onOpen?: () => void;
};

export function TaskCard({
  task,
  busy,
  onDelete,
  labels,
  meta,
  onOpen,
}: TaskCardProps) {
  const canEdit = useCan("issue.write");
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    // Fade the source while dragging; the DragOverlay shows the moving copy.
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={onOpen}
        className={cn(
          "group relative cursor-grab touch-none rounded-lg border bg-background p-2.5 text-sm shadow-sm active:cursor-grabbing",
          onOpen && "hover:border-foreground/20",
        )}
      >
        {labels ? <div className="mb-1.5">{labels}</div> : null}

        <div className="flex items-start justify-between gap-1">
          <p className="min-w-0 flex-1 break-words pr-1 leading-snug">
            {task.title}
          </p>

          {canEdit ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Issue actions"
                  disabled={busy}
                  // Stop drag + card-open from firing when opening the menu.
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="-mr-1 -mt-1 size-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
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

        {meta ? <div className="mt-1.5">{meta}</div> : null}
      </div>

      {/* Delete confirmation. */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {task.key}?</DialogTitle>
            <DialogDescription>
              This deletes “{task.title}”. This cannot be undone.
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
