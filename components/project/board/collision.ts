import { closestCenter, closestCorners, type CollisionDetection } from "@dnd-kit/core";

/**
 * Collision detection for the board, which mixes two kinds of drag in one
 * DndContext: cards (moved between and within columns) and whole columns.
 *
 * While a column is being dragged, only other columns count as targets.
 * Otherwise the cards and card drop zones inside each column are usually the
 * closest droppables, so `over` would never be a column and the columns
 * wouldn't make room or reorder on drop.
 */
export function boardCollisionDetection(columnIds: readonly string[]): CollisionDetection {
  return (args) => {
    if (!columnIds.includes(String(args.active.id))) return closestCorners(args);
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((container) =>
        columnIds.includes(String(container.id)),
      ),
    });
  };
}
