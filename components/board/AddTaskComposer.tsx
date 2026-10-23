"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  boardKeys,
  type BoardDetail,
  type ColumnWithTasks,
} from "@/lib/api/boards";
import { createTask } from "@/lib/api/tasks";

/**
 * AddTaskComposer — inline "add task" affordance pinned to a column's bottom.
 *
 * Rendered inside ColumnContainer's children slot (after the TaskList). Collapsed
 * it's a "+ Add task" button; expanded it's a title textarea. Submitting POSTs
 * to /api/columns/[id]/tasks and appends the new task to the board-detail cache
 * (so it shows at the bottom, matching the server's max(position)+1). F04 will
 * later open the detail modal from here; F03 is title-only.
 */
export function AddTaskComposer({
  columnId,
  boardId,
}: {
  columnId: string;
  boardId: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: (value: string) => createTask(columnId, value),
    onSuccess: (task) => {
      queryClient.setQueryData<BoardDetail>(
        boardKeys.detail(boardId),
        (prev) =>
          prev
            ? {
                ...prev,
                columns: prev.columns.map((c: ColumnWithTasks) =>
                  c.id === columnId
                    ? { ...c, tasks: [...c.tasks, task] }
                    : c,
                ),
              }
            : prev,
      );
      // Keep the composer open (and the autoFocus'd textarea active) for rapid
      // successive entry.
      setTitle("");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit() {
    const trimmed = title.trim();
    if (!trimmed) return;
    create.mutate(trimmed);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter submits; Shift+Enter inserts a newline; Escape closes.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setTitle("");
    }
  }

  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="mt-1 w-full justify-start text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Plus />
        Add task
      </Button>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2">
      <Textarea
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Task title…"
        rows={2}
        autoFocus
        disabled={create.isPending}
        className="resize-none bg-background text-sm"
        maxLength={200}
      />
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} loading={create.isPending} loadingText="Adding…">
          Add task
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setTitle("");
          }}
          disabled={create.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
