import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * API-route auth helper.
 *
 * Unlike `requireUser()` (which redirects — correct for pages), API route
 * handlers must answer with JSON. `getApiUser()` returns the session user or
 * `null`; handlers turn `null` into a 401 JSON response.
 */
export async function getApiUser() {
  const session = await getSession();
  return session?.user ?? null;
}

/**
 * Ownership guards.
 *
 * Every board/column handler must resolve the target row up to its owning
 * `userId` and confirm it matches the session user. When it does not (or the
 * row does not exist), callers return **404 — not 403** — so we never leak the
 * existence of another user's resources.
 *
 * Each guard returns the row (narrowed to what handlers need) on success, or
 * `null` when the row is missing or not owned by `userId`. Handlers map `null`
 * to a 404 `{ error }` response.
 */

/** Resolve a board owned by `userId`, or `null`. */
export async function findOwnedBoard(boardId: string, userId: string) {
  return db.board.findFirst({
    where: { id: boardId, userId },
  });
}

/**
 * Resolve a column whose board is owned by `userId`, or `null`.
 * Returns the column plus its `boardId` for follow-up queries.
 */
export async function findOwnedColumn(columnId: string, userId: string) {
  return db.column.findFirst({
    where: { id: columnId, board: { userId } },
  });
}
