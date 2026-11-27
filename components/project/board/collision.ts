import { closestCenter, closestCorners, type CollisionDetection, pointerWithin } from "@dnd-kit/core";

/**
 * Collision detection for the board, which mixes two kinds of drag in one
 * DndContext: cards (moved between and within columns) and whole columns.
 *
 * While a column is being dragged, only other columns count as targets.
 * Otherwise the cards and card drop zones inside each column are usually the
 * closest droppables, so `over` would never be a column and the columns
 * wouldn't make room or reorder on drop.
 *
 * While a card is being dragged, the columns themselves never count (they're
 * the big sortables that wrap everything), and the card under the pointer
 * wins. Otherwise a column, or its card drop zone, could be `over` while the
 * pointer sits on a sibling card in the same column: the drop still landed in
 * the right place, but the other cards didn't slide to make room while
 * dragging. Between cards and in empty columns, the closest card or drop zone
 * is used.
 */
export function boardCollisionDetection(columnIds: readonly string[]): CollisionDetection {
  const isColumn = (id: unknown) => columnIds.includes(String(id));
  return (args) => {
    if (isColumn(args.active.id)) {
      return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter((container) => isColumn(container.id)),
      });
    }
    const targets = args.droppableContainers.filter((container) => !isColumn(container.id));
    const cards = targets.filter((container) => !String(container.id).startsWith("column:"));
    const underPointer = pointerWithin({ ...args, droppableContainers: cards });
    if (underPointer.length) return underPointer;
    return closestCorners({ ...args, droppableContainers: targets });
  };
}
