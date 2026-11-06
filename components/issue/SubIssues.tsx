"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCanUseAi } from "@/components/ai/use-ai";
import { Avatar } from "@/components/icons/Avatar";
import { StatusIcon } from "@/components/icons/StatusIcon";
import { useCan } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { breakDownWithAi } from "@/lib/api/ai";
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

  // "Break down": AI suggests sub-issues; the person picks which to add.
  const canBreakDown = useCanUseAi() && canEdit && issue.type !== "SUBTASK" && issue.type !== "EPIC";
  const [suggested, setSuggested] = useState<{ title: string; picked: boolean }[] | null>(null);
  const suggest = useMutation({
    mutationFn: () => breakDownWithAi(issue.id),
    onSuccess: ({ subIssues }) => {
      if (!subIssues.length) toast("No new sub-issues to suggest.");
      setSuggested(subIssues.length ? subIssues.map((s) => ({ title: s.title, picked: true })) : null);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const addPicked = useMutation({
    mutationFn: async (titles: string[]) => {
      // One at a time, so they're numbered in the suggested order.
      for (const title of titles) await createSubIssue(issue.id, title);
      return titles.length;
    },
    onSuccess: (count) => {
      setSuggested(null);
      toast.success(count === 1 ? "Added 1 sub-issue." : `Added ${count} sub-issues.`);
    },
    onError: (error: Error) => toast.error(error.message),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.detail(issue.id) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(issue.projectId) });
    },
  });
  const picked = suggested?.filter((s) => s.picked) ?? [];

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
        {canBreakDown && !suggested ? (
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto text-muted-foreground"
            loading={suggest.isPending}
            loadingText="Thinking…"
            onClick={() => suggest.mutate()}
          >
            <Sparkles />
            Break down
          </Button>
        ) : null}
      </div>
      {suggested ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary-text">
            <Sparkles className="size-3.5" />
            Suggested sub-issues
          </p>
          <ul className="flex flex-col gap-1">
            {suggested.map((s, index) => (
              <li key={index}>
                <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/60">
                  <input
                    type="checkbox"
                    checked={s.picked}
                    onChange={() =>
                      setSuggested(suggested.map((x, i) => (i === index ? { ...x, picked: !x.picked } : x)))
                    }
                    className="mt-1 accent-primary"
                  />
                  <span className={cn(s.picked ? "text-foreground" : "text-muted-foreground line-through")}>{s.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSuggested(null)} disabled={addPicked.isPending}>
              Dismiss
            </Button>
            <Button
              size="sm"
              disabled={!picked.length}
              loading={addPicked.isPending}
              loadingText="Adding…"
              onClick={() => addPicked.mutate(picked.map((s) => s.title))}
            >
              {picked.length === 1 ? "Add 1 sub-issue" : `Add ${picked.length} sub-issues`}
            </Button>
          </div>
        </div>
      ) : null}
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
