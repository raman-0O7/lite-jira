/**
 * Client-side fetchers + TanStack Query keys for boards & columns.
 *
 * Every helper throws an `Error` (message taken from the API's `{ error }`
 * shape) on a non-2xx response so React Query's `onError` / mutation error
 * paths can surface it via a sonner toast.
 */

// ---------- Shared types (also consumed by F03) ----------

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

/** A label as embedded on a task / returned from the labels endpoints. */
export type LabelStub = {
  id: string;
  name: string;
  color: string;
};

/** A board as shown in the boards list. */
export type BoardSummary = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  columnCount: number;
};

/**
 * A task stub embedded in a column. F03 owns the base task shape; F04 adds
 * `labels` (additively) so cards can render label chips off the board payload.
 */
export type TaskStub = {
  id: string;
  title: string;
  position: number;
  priority: Priority;
  dueDate: string | null;
  labels: LabelStub[];
};

/** A column with its ordered tasks, as returned by GET /api/boards/[id]. */
export type ColumnWithTasks = {
  id: string;
  name: string;
  position: number;
  tasks: TaskStub[];
};

/** A board plus its ordered columns. */
export type BoardDetail = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  columns: ColumnWithTasks[];
};

// ---------- Query keys ----------

export const boardKeys = {
  all: ["boards"] as const,
  lists: () => [...boardKeys.all, "list"] as const,
  detail: (id: string) => [...boardKeys.all, "detail", id] as const,
};

// ---------- Internal helpers ----------

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

// ---------- Boards ----------

export async function fetchBoards(): Promise<BoardSummary[]> {
  const res = await fetch("/api/boards");
  if (!res.ok) await parseError(res, "Failed to load boards");
  const data = (await res.json()) as { boards: BoardSummary[] };
  return data.boards;
}

export async function fetchBoard(id: string): Promise<BoardDetail> {
  const res = await fetch(`/api/boards/${id}`);
  if (!res.ok) await parseError(res, "Failed to load board");
  const data = (await res.json()) as { board: BoardDetail };
  return data.board;
}

export async function createBoard(name: string): Promise<BoardSummary> {
  const res = await fetch("/api/boards", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await parseError(res, "Failed to create board");
  const data = (await res.json()) as { board: BoardSummary };
  return data.board;
}

export async function renameBoard(
  id: string,
  name: string,
): Promise<BoardSummary> {
  const res = await fetch(`/api/boards/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await parseError(res, "Failed to rename board");
  const data = (await res.json()) as { board: BoardSummary };
  return data.board;
}

export async function deleteBoard(id: string): Promise<void> {
  const res = await fetch(`/api/boards/${id}`, { method: "DELETE" });
  if (!res.ok) await parseError(res, "Failed to delete board");
}

// ---------- Columns ----------

export async function createColumn(
  boardId: string,
  name: string,
): Promise<ColumnWithTasks> {
  const res = await fetch(`/api/boards/${boardId}/columns`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await parseError(res, "Failed to add column");
  const data = (await res.json()) as { column: ColumnWithTasks };
  return data.column;
}

export async function renameColumn(
  id: string,
  name: string,
): Promise<{ id: string; name: string; position: number }> {
  const res = await fetch(`/api/columns/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) await parseError(res, "Failed to rename column");
  const data = (await res.json()) as {
    column: { id: string; name: string; position: number };
  };
  return data.column;
}

export async function deleteColumn(id: string): Promise<void> {
  const res = await fetch(`/api/columns/${id}`, { method: "DELETE" });
  if (!res.ok) await parseError(res, "Failed to delete column");
}

export async function reorderColumns(
  boardId: string,
  orderedIds: string[],
): Promise<void> {
  const res = await fetch("/api/columns/reorder", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ boardId, orderedIds }),
  });
  if (!res.ok) await parseError(res, "Failed to reorder columns");
}
