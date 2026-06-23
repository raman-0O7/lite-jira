"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { DueDatePicker } from "@/components/board/DueDatePicker";
import { LabelChip } from "@/components/board/LabelChip";
import { LabelPicker } from "@/components/board/LabelPicker";
import { PrioritySelect } from "@/components/board/PrioritySelect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  boardKeys,
  type BoardDetail,
  type LabelStub,
  type Priority,
} from "@/lib/api/boards";
import { labelKeys } from "@/lib/api/labels";
import { fetchTask, updateTask, type TaskFull } from "@/lib/api/tasks";

/**
 * TaskModal — the task detail / edit modal (Feature 04).
 *
 * Opened from a TaskCard's `onOpen` (a non-drag click). The board-detail cache
 * is the source of truth for the card-visible fields (title, priority, dueDate,
 * labels); we also `fetchTask` for the full `description`. Every edit:
 *   1. optimistically patches the board cache so the card updates instantly, and
 *   2. persists via PATCH /api/tasks/[id]; on failure we roll back + toast.
 *
 * Saves are field-scoped, so a failed label change never reverts an unrelated
 * priority edit.
 */
export function TaskModal({
  boardId,
  taskId,
  open,
  onOpenChange,
  onDeleted,
}: {
  boardId: string;
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful delete so the parent can drop the card. */
  onDeleted: (taskId: string) => void;
}) {
  const queryClient = useQueryClient();

  // Full task (for description). Card-visible fields are read from the board
  // cache so the modal reflects optimistic edits immediately.
  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => fetchTask(taskId as string),
    enabled: open && taskId !== null,
  });

  const task = taskQuery.data;

  // Local edit buffers. We re-seed them from the freshly loaded task by
  // adjusting state during render (the React-recommended alternative to a
  // sync effect): when the loaded task's identity changes, reset the drafts
  // in the same pass instead of after a paint.
  const [syncedKey, setSyncedKey] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");
  const [editingDesc, setEditingDesc] = useState(false);

  // Key changes when a different task loads OR the server-confirmed values
  // change (e.g. after a save), so drafts stay reconciled with the source.
  const taskKey = task
    ? `${task.id}:${task.title}:${task.description ?? ""}`
    : null;
  if (task && taskKey !== syncedKey) {
    setSyncedKey(taskKey);
    setTitleDraft(task.title);
    setDescDraft(task.description ?? "");
    setEditingDesc(false);
  }

  // ---- board-cache helpers (optimistic card updates) -----------------------

  function patchStub(updater: (prev: BoardStubFields) => Partial<BoardStubFields>) {
    queryClient.setQueryData<BoardDetail>(boardKeys.detail(boardId), (prev) => {
      if (!prev || !taskId) return prev;
      return {
        ...prev,
        columns: prev.columns.map((col) => ({
          ...col,
          tasks: col.tasks.map((t) =>
            t.id === taskId ? { ...t, ...updater(t) } : t,
          ),
        })),
      };
    });
  }

  function snapshotBoard(): BoardDetail | undefined {
    return queryClient.getQueryData<BoardDetail>(boardKeys.detail(boardId));
  }

  // ---- generic field save --------------------------------------------------

  const save = useMutation({
    mutationFn: (vars: {
      payload: Parameters<typeof updateTask>[1];
      previous: BoardDetail | undefined;
    }) => updateTask(taskId as string, vars.payload),
    onSuccess: (updated) => {
      // Keep the full-task cache (description etc.) in sync with the server.
      queryClient.setQueryData<TaskFull>(["task", taskId], updated);
    },
    onError: (error: Error, vars) => {
      if (vars.previous) {
        queryClient.setQueryData(boardKeys.detail(boardId), vars.previous);
      }
      toast.error(error.message);
    },
  });

  function commitField(
    payload: Parameters<typeof updateTask>[1],
    optimistic: () => void,
  ) {
    if (!taskId) return;
    const previous = snapshotBoard();
    optimistic();
    save.mutate({ payload, previous });
  }

  // ---- field handlers ------------------------------------------------------

  function commitTitle() {
    const trimmed = titleDraft.trim();
    if (!task || !trimmed || trimmed === task.title) {
      setTitleDraft(task?.title ?? "");
      return;
    }
    commitField({ title: trimmed }, () =>
      patchStub(() => ({ title: trimmed })),
    );
  }

  function commitDescription() {
    if (!task) return;
    const next = descDraft;
    setEditingDesc(false);
    if ((task.description ?? "") === next) return;
    commitField({ description: next.length ? next : null }, () => {
      // Description isn't on the card stub; keep the full-task cache fresh.
      queryClient.setQueryData<TaskFull>(["task", taskId], (prev) =>
        prev ? { ...prev, description: next.length ? next : null } : prev,
      );
    });
  }

  function changePriority(next: Priority) {
    if (!task || next === task.priority) return;
    commitField({ priority: next }, () => patchStub(() => ({ priority: next })));
  }

  function changeDueDate(next: string | null) {
    if (!task) return;
    commitField({ dueDate: next }, () => patchStub(() => ({ dueDate: next })));
  }

  function changeLabels(nextIds: string[], allLabels: LabelStub[]) {
    if (!task) return;
    const nextLabels = nextIds
      .map((id) => allLabels.find((l) => l.id === id))
      .filter((l): l is LabelStub => Boolean(l));
    commitField({ labelIds: nextIds }, () => {
      patchStub(() => ({ labels: nextLabels }));
      queryClient.setQueryData<TaskFull>(["task", taskId], (prev) =>
        prev ? { ...prev, labels: nextLabels } : prev,
      );
    });
  }

  // Delete handled by parent (it owns the board-cache removal mutation).
  function handleDelete() {
    if (taskId) onDeleted(taskId);
    onOpenChange(false);
  }

  const labelOptions =
    queryClient.getQueryData<LabelStub[]>(labelKeys.board(boardId)) ?? [];
  // Merge in the task's own labels in case the board-labels cache isn't loaded.
  const knownLabels: LabelStub[] = task
    ? [
        ...task.labels,
        ...labelOptions.filter(
          (o) => !task.labels.some((tl) => tl.id === o.id),
        ),
      ]
    : labelOptions;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="sr-only">Task details</DialogTitle>
        </DialogHeader>

        {taskQuery.isPending ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Loading…
          </p>
        ) : taskQuery.isError ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {(taskQuery.error as Error).message}
          </p>
        ) : task ? (
          <div className="flex flex-col gap-4">
            {/* Title (inline edit) */}
            <Input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === "Escape") {
                  setTitleDraft(task.title);
                  event.currentTarget.blur();
                }
              }}
              className="text-base font-medium"
              maxLength={200}
              aria-label="Task title"
              disabled={save.isPending}
            />

            {/* Priority + due date */}
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Priority
                </span>
                <PrioritySelect
                  value={task.priority}
                  onChange={changePriority}
                  disabled={save.isPending}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Due date
                </span>
                <DueDatePicker
                  value={task.dueDate}
                  onChange={changeDueDate}
                  disabled={save.isPending}
                />
              </div>
            </div>

            {/* Labels */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Labels
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {task.labels.map((label) => (
                  <LabelChip
                    key={label.id}
                    label={label}
                    onRemove={() =>
                      changeLabels(
                        task.labels
                          .filter((l) => l.id !== label.id)
                          .map((l) => l.id),
                        knownLabels,
                      )
                    }
                  />
                ))}
                <LabelPicker
                  boardId={boardId}
                  selectedIds={task.labels.map((l) => l.id)}
                  onChange={(ids) => {
                    const all =
                      queryClient.getQueryData<LabelStub[]>(
                        labelKeys.board(boardId),
                      ) ?? knownLabels;
                    changeLabels(ids, all);
                  }}
                  disabled={save.isPending}
                />
              </div>
            </div>

            {/* Description: edit (textarea) / preview (markdown) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  Description
                </span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    if (editingDesc) {
                      commitDescription();
                    } else {
                      setEditingDesc(true);
                    }
                  }}
                  disabled={save.isPending}
                >
                  {editingDesc ? (
                    <>
                      <Eye />
                      Preview
                    </>
                  ) : (
                    <>
                      <Pencil />
                      Edit
                    </>
                  )}
                </Button>
              </div>
              {editingDesc ? (
                <Textarea
                  value={descDraft}
                  onChange={(event) => setDescDraft(event.target.value)}
                  onBlur={commitDescription}
                  placeholder="Add a description… (Markdown supported)"
                  rows={6}
                  className="resize-none"
                  autoFocus
                  disabled={save.isPending}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setEditingDesc(true)}
                  className="min-h-16 w-full rounded-lg border border-dashed px-2.5 py-2 text-left text-sm"
                >
                  {descDraft.trim() ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none break-words [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:text-base [&_h2]:text-sm [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5">
                      <ReactMarkdown>{descDraft}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      No description. Click to add one.
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={handleDelete}
            disabled={!task}
          >
            <Trash2 />
            Delete task
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// The subset of TaskStub fields the modal optimistically patches on the card.
type BoardStubFields = {
  id: string;
  title: string;
  priority: Priority;
  dueDate: string | null;
  labels: LabelStub[];
};
