/**
 * Pure drag-and-drop position helpers for the Kanban board.
 *
 * These functions are deliberately free of React, dnd-kit, and Prisma so they
 * can be unit-tested in isolation and shared between the server (the
 * `/api/tasks/move` transaction) and the client (optimistic reordering in
 * KanbanBoard). The server is authoritative; the client mirrors the same math
 * so the optimistic state matches what the server will persist.
 *
 * Position strategy (PLAN §7, Feature 03): integer `position`, contiguous
 * 0..n-1 per column. Every move reindexes the affected column(s) so positions
 * never collide. A gap/float strategy (to avoid rewriting every row) is a
 * possible future optimization — unnecessary at solo scale.
 */

/** The minimum a task identity needs for reordering math. */
export type Positioned = { id: string };

/** Clamp `position` into the valid insertion range [0, length]. */
export function clampPosition(position: number, length: number): number {
  if (position < 0) return 0;
  if (position > length) return length;
  return position;
}

/**
 * Compute the reindexed order of one column after inserting `taskId` at
 * `toPosition`. `siblings` must be the target column's tasks ordered by
 * position, EXCLUDING the moved task. Returns ids in their new order, where
 * each id's array index is its new `position`.
 */
export function insertAt(
  siblings: Positioned[],
  taskId: string,
  toPosition: number,
): string[] {
  const ids = siblings.map((t) => t.id);
  const index = clampPosition(toPosition, ids.length);
  ids.splice(index, 0, taskId);
  return ids;
}

/** Result of computing a move: the new order of each affected column. */
export type MovePlan = {
  /** Target column ids in final order (index === position). */
  target: string[];
  /**
   * Source column ids in final order, or `null` when the move is intra-column
   * (source === target, so only `target` needs rewriting).
   */
  source: string[] | null;
};

/**
 * Plan a task move across (or within) columns.
 *
 * - `sourceSiblings` / `targetSiblings`: each column's tasks ordered by
 *   position, EXCLUDING the moved task in both lists.
 * - Intra-column: pass the same logical column for both; `source` is `null`
 *   and `target` holds the reindexed order.
 * - Cross-column: `target` gets the task inserted at `toPosition`; `source` is
 *   the source column reindexed to 0..n-1 with the task removed.
 */
export function planMove(args: {
  taskId: string;
  sameColumn: boolean;
  sourceSiblings: Positioned[];
  targetSiblings: Positioned[];
  toPosition: number;
}): MovePlan {
  const { taskId, sameColumn, sourceSiblings, targetSiblings, toPosition } =
    args;

  const target = insertAt(targetSiblings, taskId, toPosition);

  if (sameColumn) {
    return { target, source: null };
  }

  // Source already excludes the moved task, so it's simply its current order.
  return { target, source: sourceSiblings.map((t) => t.id) };
}
