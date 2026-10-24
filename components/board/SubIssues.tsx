"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CircleDashed, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/board/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createSubIssue, issueKeys, type IssueFull } from "@/lib/api/issues";
import { projectKeys, type ProjectDetail } from "@/lib/api/projects";

/** Sub-issue checklist with progress and an inline "add" row. */
export function SubIssues({
  issue,
  onOpen,
}: {
  issue: IssueFull;
  /** Open another issue in the modal. */
  onOpen: (issueId: string) => void;
}) {
  const queryClient = useQueryClient();
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Sub-issues</span>
        {total > 0 ? (
          <>
            <span className="text-xs text-muted-foreground tabular-nums">
              {done} of {total}
            </span>
            <span className="h-1 w-16 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-1 bg-emerald-500"
                style={{ width: `${(done / total) * 100}%` }}
              />
            </span>
          </>
        ) : null}
      </div>
      {issue.subIssues.length > 0 ? (
        <ul className="flex flex-col rounded-lg border">
          {issue.subIssues.map((sub) => (
            <li key={sub.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(sub.id)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-muted/50"
              >
                {sub.done ? (
                  <CircleCheck className="size-4 shrink-0 text-emerald-500" aria-label="Done" />
                ) : (
                  <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-label="Open" />
                )}
                <span className="font-mono text-[11px] text-muted-foreground">{sub.key}</span>
                <span className={sub.done ? "truncate text-muted-foreground line-through" : "truncate"}>
                  {sub.title}
                </span>
                {sub.assignee ? <Avatar person={sub.assignee} className="ml-auto" /> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Add a sub-issue…"
          aria-label="New sub-issue title"
          maxLength={200}
          className="h-8"
        />
        <Button
          type="submit"
          size="sm"
          variant="outline"
          loading={add.isPending}
          disabled={!title.trim()}
        >
          <Plus />
          Add
        </Button>
      </form>
    </div>
  );
}
