/**
 * Client-side fetchers for tasks (Feature 03).
 *
 * Mirrors the conventions in lib/api/boards.ts: every helper throws an `Error`
 * (message from the API's `{ error }` shape) on a non-2xx response so React
 * Query's error paths can surface it via a sonner toast.
 *
 * Tasks live inside the board detail cache (boardKeys.detail). These helpers
 * own task mutations; KanbanBoard applies optimistic updates against that cache
 * and reconciles with these results.
 */

import type { Priority, TaskStub } from "@/lib/api/boards";

/** Full task as returned by GET /api/tasks/[id]. F04's modal reuses this. */
export type TaskFull = {
  id: string;
  title: string;
  description: string | null;
  priority: Priority;
  dueDate: string | null;
  position: number;
  columnId: string;
  labels: { id: string; name: string; color: string }[];
};

async function parseError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) message = data.error;
  } catch {
    // Non-JSON body; keep the fallback message.
  }
  throw new Error(message);
}

/** POST /api/columns/[id]/tasks {title} → the created task stub. */
export async function createTask(
  columnId: string,
  title: string,
): Promise<TaskStub> {
  const res = await fetch(`/api/columns/${columnId}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) await parseError(res, "Failed to add task");
  const data = (await res.json()) as { task: TaskStub };
  return data.task;
}

/** GET /api/tasks/[id] → the full task. */
export async function fetchTask(id: string): Promise<TaskFull> {
  const res = await fetch(`/api/tasks/${id}`);
  if (!res.ok) await parseError(res, "Failed to load task");
  const data = (await res.json()) as { task: TaskFull };
  return data.task;
}

/** PATCH /api/tasks/[id] {title} → update the title. */
export async function updateTaskTitle(
  id: string,
  title: string,
): Promise<TaskStub> {
  const res = await fetch(`/api/tasks/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) await parseError(res, "Failed to update task");
  const data = (await res.json()) as { task: TaskStub };
  return data.task;
}

/** DELETE /api/tasks/[id]. */
export async function deleteTask(id: string): Promise<void> {
  const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  if (!res.ok) await parseError(res, "Failed to delete task");
}

/** PATCH /api/tasks/move — reposition within / across columns. */
export async function moveTask(args: {
  taskId: string;
  toColumnId: string;
  toPosition: number;
}): Promise<void> {
  const res = await fetch("/api/tasks/move", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) await parseError(res, "Failed to move task");
}
