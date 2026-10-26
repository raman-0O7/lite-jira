"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { createIssue } from "@/lib/api/issues";
import { type ColumnWithIssues, type ProjectDetail, projectKeys } from "@/lib/api/projects";

/**
 * Quick add at the bottom of a column: a ghost "Add issue" that expands into
 * a title field. Enter adds and keeps it open for the next one; Esc closes.
 */
export function AddIssueComposer({ columnId, projectId }: { columnId: string; projectId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: (value: string) => createIssue(columnId, value),
    onSuccess: (issue) => {
      queryClient.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (prev) =>
        prev
          ? {
              ...prev,
              columns: prev.columns.map((c: ColumnWithIssues) =>
                c.id === columnId ? { ...c, issues: [...c.issues, issue] } : c,
              ),
            }
          : prev,
      );
      setTitle("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit() {
    const trimmed = title.trim();
    if (trimmed) create.mutate(trimmed);
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="w-full shrink-0 justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus />
        Add issue
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-lg border bg-surface p-2 shadow-card">
      <textarea
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          // Enter submits; Shift+Enter inserts a newline; Escape closes.
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            setTitle("");
          }
        }}
        placeholder="Issue title…"
        aria-label="New issue title"
        rows={2}
        autoFocus
        disabled={create.isPending}
        className="w-full resize-none bg-transparent px-1 text-sm font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground"
        maxLength={200}
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button
          variant="ghost"
          size="xs"
          onClick={() => {
            setOpen(false);
            setTitle("");
          }}
          disabled={create.isPending}
        >
          Cancel
        </Button>
        <Button size="xs" onClick={submit} loading={create.isPending} loadingText="Adding…">
          Add issue
        </Button>
      </div>
    </div>
  );
}
