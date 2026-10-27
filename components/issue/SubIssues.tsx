"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/icons/Avatar";
import { StatusIcon } from "@/components/icons/StatusIcon";
import { useCan } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { createSubIssue, issueKeys, type IssueFull } from "@/lib/api/issues";
import { projectKeys, type ProjectDetail } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

/** Sub-issues with a progress bar and an inline "add" row. */
export function SubIssues({
  issue,
  onOpen,
}: {
  issue: IssueFull;
  /** Open another issue, by key. */
  onOpen: (key: string) => void;
}) {
  const queryClient = useQueryClient();
  const canEdit = useCan("issue.write");
  const [title, setTitle] = useState("");

  const add = useMutation({
    mutationFn: (value: string) => createSubIssue(issue.id, value),
    onSuccess: (card) => {
      setTitle("");
      // The new card appears on the board in its column, and the parent's
      // card counts it…
      queryClient.setQueryData<ProjectDetail>(projectKeys.detail(issue.projectId), (prev) =>
        prev
          ? {
              ...prev,
              columns: prev.columns.map((column) => {
                const issues = column.issues.map((i) =>
                  i.id === issue.id ? { ...i, subIssueCount: i.subIssueCount + 1 } : i,
                );
                return {
                  ...column,
                  issues: column.id === card.columnId ? [...issues, card] : issues,
                };
              }),
            }
          : prev,
      );
      // …and in this issue's list.
      queryClient.invalidateQueries({ queryKey: issueKeys.detail(issue.id) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (trimmed) add.mutate(trimmed);
  }

  const done = issue.subIssueDoneCount;
  const total = issue.subIssueCount;

  return (
    <section aria-label="Sub-issues" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="font-heading text-sm font-semibold text-foreground">Sub-issues</h2>
        {total > 0 ? (
          <>
            <span className="text-xs text-muted-foreground tabular">
              {done}/{total}
            </span>
            <span className="h-1 w-20 overflow-hidden rounded-full bg-track">
              <span className="block h-1 rounded-full bg-success" style={{ width: `${(done / total) * 100}%` }} />
            </span>
          </>
        ) : null}
      </div>
      {issue.subIssues.length > 0 || canEdit ? (
        <ul className="flex flex-col overflow-hidden rounded-lg border">
          {issue.subIssues.map((sub) => (
            <li key={sub.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(sub.key)}
                className="flex h-9 w-full items-center gap-2.5 px-3 text-left text-sm hover:bg-accent/60"
              >
                <StatusIcon variant={sub.done ? "done" : "todo"} label={sub.done ? "Done" : "Open"} />
                <span className="shrink-0 font-mono text-2xs text-muted-foreground">{sub.key}</span>
                <span className={cn("min-w-0 flex-1 truncate", sub.done ? "text-muted-foreground line-through" : "text-foreground")}>
                  {sub.title}
                </span>
                {sub.assignee ? <Avatar person={sub.assignee} /> : null}
              </button>
            </li>
          ))}
          {canEdit ? (
            <li>
              <form onSubmit={submit} className="flex h-9 items-center gap-2.5 px-3">
                <Plus className="size-3.5 shrink-0 text-icon" />
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Add a sub-issue…"
                  aria-label="New sub-issue title"
                  maxLength={200}
                  disabled={add.isPending}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {title.trim() ? (
                  <Button type="submit" size="xs" loading={add.isPending}>
                    Add
                  </Button>
                ) : null}
              </form>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
