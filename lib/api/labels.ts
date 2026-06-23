/**
 * Client-side fetchers + query keys for labels (Feature 04).
 *
 * Mirrors lib/api/boards.ts conventions: every helper throws an `Error`
 * (message from the API's `{ error }` shape) on a non-2xx response so React
 * Query's error paths can surface it via a sonner toast.
 */

import type { LabelStub } from "@/lib/api/boards";

export type { LabelStub };

export const labelKeys = {
  all: ["labels"] as const,
  board: (boardId: string) => [...labelKeys.all, "board", boardId] as const,
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

/** GET /api/boards/[id]/labels → the board's labels. */
export async function fetchBoardLabels(boardId: string): Promise<LabelStub[]> {
  const res = await fetch(`/api/boards/${boardId}/labels`);
  if (!res.ok) await parseError(res, "Failed to load labels");
  const data = (await res.json()) as { labels: LabelStub[] };
  return data.labels;
}

/** POST /api/boards/[id]/labels {name, color} → the created label. */
export async function createLabel(
  boardId: string,
  input: { name: string; color: string },
): Promise<LabelStub> {
  const res = await fetch(`/api/boards/${boardId}/labels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await parseError(res, "Failed to create label");
  const data = (await res.json()) as { label: LabelStub };
  return data.label;
}

/** PATCH /api/labels/[id] {name?, color?} → the updated label. */
export async function updateLabel(
  id: string,
  input: { name?: string; color?: string },
): Promise<LabelStub> {
  const res = await fetch(`/api/labels/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) await parseError(res, "Failed to update label");
  const data = (await res.json()) as { label: LabelStub };
  return data.label;
}

/** DELETE /api/labels/[id]. */
export async function deleteLabel(id: string): Promise<void> {
  const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
  if (!res.ok) await parseError(res, "Failed to delete label");
}
