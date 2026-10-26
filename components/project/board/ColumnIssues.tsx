"use client";

import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";

import { BoardIssueCard } from "@/components/project/board/BoardIssueCard";
import type { IssueCard } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

/**
 * The cards of one column. Wraps them in a per-column SortableContext and
 * registers a column droppable (`column:<id>`) so an empty column, or the space
 * below the last card, still accepts a drop. KanbanBoard runs the actual move.
 */
export function ColumnIssues({
  columnId,
  issues,
  filtered,
  busy,
  onDeleteIssue,
  onOpenIssue,
  footer,
}: {
  columnId: string;
  issues: IssueCard[];
  /** The column has issues, but the active filters hide them all. */
  filtered?: boolean;
  busy?: boolean;
  onDeleteIssue: (issueId: string) => void;
  onOpenIssue: (issueId: string) => void;
  /** Shown right below the cards (the quick-add composer). */
  footer?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${columnId}`,
    data: { type: "column", columnId },
  });

  return (
    <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cn(
          "flex min-h-16 flex-1 flex-col gap-2 rounded-lg transition-colors",
          isOver && "bg-primary-soft",
        )}
      >
        {issues.map((issue) => (
          <BoardIssueCard
            key={issue.id}
            issue={issue}
            busy={busy}
            onDelete={() => onDeleteIssue(issue.id)}
            onOpen={() => onOpenIssue(issue.id)}
          />
        ))}
        {issues.length === 0 ? (
          <p className="rounded-lg border border-dashed px-2 py-5 text-center text-xs text-muted-foreground">
            {filtered ? "No matching issues" : "No issues"}
          </p>
        ) : null}
        {footer}
      </div>
    </SortableContext>
  );
}
