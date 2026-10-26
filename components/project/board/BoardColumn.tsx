"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { ColumnHeader } from "@/components/project/board/ColumnHeader";
import type { ColumnCategory, ColumnWithIssues } from "@/lib/api/projects";
import type { StatusVariant } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * One board column: a sortable shell (columns reorder horizontally) with its
 * header, and the issue list + composer passed as children.
 */
export function BoardColumn({
  column,
  variant,
  busy,
  onRename,
  onDelete,
  onSetCategory,
  onAddIssue,
  children,
}: {
  column: ColumnWithIssues;
  variant: StatusVariant;
  busy?: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSetCategory: (category: ColumnCategory) => void;
  onAddIssue?: () => void;
  children: React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.id,
  });

  return (
    <section
      ref={setNodeRef}
      aria-label={column.name}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex h-full max-w-[360px] min-w-[256px] flex-1 basis-0 flex-col gap-2",
        isDragging && "opacity-40",
      )}
    >
      <ColumnHeader
        column={column}
        variant={variant}
        taskCount={column.issues.length}
        busy={busy}
        onRename={onRename}
        onDelete={onDelete}
        onSetCategory={onSetCategory}
        onAddIssue={onAddIssue}
        dragHandleProps={{ attributes, listeners }}
      />
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-3">{children}</div>
    </section>
  );
}
