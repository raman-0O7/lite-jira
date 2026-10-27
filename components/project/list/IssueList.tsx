"use client";

import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import { Avatar } from "@/components/icons/Avatar";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { PriorityIcon } from "@/components/icons/PriorityIcon";
import { StatusIcon } from "@/components/icons/StatusIcon";
import { AgentAvatar, cardRunStatus, RunStatusBadge } from "@/components/issue/AgentBadges";
import { DueDate } from "@/components/issue/DueDate";
import { LabelChip } from "@/components/issue/LabelChip";
import { useCan } from "@/components/providers/workspace-provider";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { ColumnWithIssues, IssueCard } from "@/lib/api/projects";
import type { StatusVariant } from "@/lib/status";
import { cn } from "@/lib/utils";

/**
 * The list view: issues grouped by column, one dense row each. `J` / `K` move
 * the selection and `Enter` opens it (when no panel or dialog has focus).
 */
export function IssueList({
  columns,
  visible,
  variants,
  filtersActive,
  openIssueId,
  keyboardEnabled,
  onOpenIssue,
  onAddIssue,
}: {
  columns: ColumnWithIssues[];
  /** The issues each column shows after filtering. */
  visible: (column: ColumnWithIssues) => IssueCard[];
  variants: Map<string, StatusVariant>;
  filtersActive: boolean;
  openIssueId: string | null;
  keyboardEnabled: boolean;
  onOpenIssue: (issueId: string) => void;
  onAddIssue: (columnId: string) => void;
}) {
  const canEdit = useCan("issue.write");
  const groups = columns.map((column) => ({ column, issues: visible(column) }));
  const flat = groups.flatMap((g) => g.issues);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const current = selectedId ?? openIssueId;

  function move(delta: number) {
    if (flat.length === 0) return;
    const index = flat.findIndex((i) => i.id === current);
    const next = flat[index === -1 ? 0 : Math.min(Math.max(index + delta, 0), flat.length - 1)]!;
    setSelectedId(next.id);
    rowRefs.current.get(next.id)?.focus();
  }

  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      // Only when nothing else (a toolbar button, a menu) would take the Enter.
      enter: (event) => {
        const target = event.target as Node;
        if (!current || (target !== document.body && !listRef.current?.contains(target))) return false;
        onOpenIssue(current);
      },
    },
    keyboardEnabled,
  );

  return (
    <div ref={listRef} className="h-full overflow-y-auto pb-6">
      {groups.map(({ column, issues }) => (
        <section key={column.id} aria-label={column.name}>
          <header className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b bg-[color-mix(in_srgb,var(--background)_92%,var(--foreground))] px-4 md:px-5">
            <StatusIcon variant={variants.get(column.id) ?? "started"} />
            <h2 className="text-sm font-semibold text-foreground">{column.name}</h2>
            <span className="text-xs text-muted-foreground tabular">
              {issues.length}
              {filtersActive && issues.length !== column.issues.length ? ` of ${column.issues.length}` : ""}
            </span>
            {canEdit ? (
              <button
                type="button"
                onClick={() => onAddIssue(column.id)}
                aria-label={`Add issue to ${column.name}`}
                className="ml-auto flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Plus className="size-3.5" />
              </button>
            ) : null}
          </header>
          {issues.length === 0 ? (
            <p className="border-b px-4 py-2.5 text-xs text-muted-foreground md:px-5">
              {filtersActive && column.issues.length > 0 ? "No matching issues" : "No issues"}
            </p>
          ) : (
            <ul>
              {issues.map((issue) => {
                const selected = issue.id === current;
                const runStatus = cardRunStatus(issue.agentRuns);
                return (
                  <li key={issue.id}>
                    <button
                      type="button"
                      ref={(node) => {
                        if (node) rowRefs.current.set(issue.id, node);
                        else rowRefs.current.delete(issue.id);
                      }}
                      onFocus={() => setSelectedId(issue.id)}
                      onClick={() => onOpenIssue(issue.id)}
                      aria-current={selected ? "true" : undefined}
                      className={cn(
                        "flex h-9 w-full items-center gap-3 border-b px-4 text-left text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent md:px-5",
                        selected && "bg-accent/80",
                      )}
                    >
                      <PriorityIcon priority={issue.priority} />
                      <span className="w-[68px] shrink-0 truncate font-mono text-2xs text-muted-foreground">
                        {issue.key}
                      </span>
                      <StatusIcon variant={variants.get(column.id) ?? "started"} label={column.name} />
                      <IssueTypeIcon type={issue.type} />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{issue.title}</span>
                      <span className="hidden max-w-[40%] shrink items-center gap-1 overflow-hidden lg:flex">
                        {issue.labels.map((label) => (
                          <LabelChip key={label.id} label={label} />
                        ))}
                      </span>
                      {issue.subIssueCount > 0 ? (
                        <span className="hidden text-2xs text-muted-foreground tabular sm:inline">
                          {issue.subIssueDoneCount}/{issue.subIssueCount}
                        </span>
                      ) : null}
                      {issue.dueDate ? <DueDate value={issue.dueDate} className="hidden sm:inline-flex" /> : null}
                      {runStatus ? (
                        <RunStatusBadge
                          status={runStatus}
                          name={issue.assigneeAgent?.name}
                          className="hidden sm:inline-flex"
                        />
                      ) : null}
                      <span className="flex w-5 shrink-0 justify-end">
                        {issue.assigneeAgent ? (
                          <AgentAvatar name={issue.assigneeAgent.name} />
                        ) : issue.assignee ? (
                          <Avatar person={issue.assignee} />
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
      {columns.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">This project has no columns yet.</p>
      ) : null}
    </div>
  );
}
