import type { ClientRect, CollisionDetection } from "@dnd-kit/core";
import { describe, expect, it } from "vitest";

import { boardCollisionDetection } from "@/components/project/board/collision";

type Args = Parameters<CollisionDetection>[0];

const rect = (left: number, top: number, width: number, height: number): ClientRect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

/** Two columns side by side, each holding a card and a card drop zone. */
const droppables: Record<string, ClientRect> = {
  todo: rect(0, 0, 300, 800),
  "column:todo": rect(0, 50, 300, 750),
  "card-1": rect(10, 60, 280, 80),
  doing: rect(320, 0, 300, 800),
  "column:doing": rect(320, 50, 300, 750),
  "card-2": rect(330, 60, 280, 80),
};

function args(activeId: string, pointer: ClientRect): Args {
  const containers = Object.keys(droppables).map((id) => ({ id, rect: { current: droppables[id] } }));
  return {
    active: { id: activeId },
    collisionRect: pointer,
    droppableRects: new Map(Object.entries(droppables)),
    droppableContainers: containers,
    pointerCoordinates: { x: pointer.left, y: pointer.top },
  } as unknown as Args;
}

const detect = boardCollisionDetection(["todo", "doing"]);

describe("board collision detection", () => {
  it("only targets columns while a column is dragged, even over a card", () => {
    const overCard = rect(335, 65, 280, 40); // the dragged header sits on card-2
    expect(detect(args("todo", overCard))[0]?.id).toBe("doing");
  });

  it("never reports a card or card drop zone for a column drag", () => {
    const ids = detect(args("doing", rect(5, 400, 280, 40))).map((c) => String(c.id));
    expect(ids.every((id) => id === "todo" || id === "doing")).toBe(true);
    expect(ids[0]).toBe("todo");
  });

  it("still lets cards target other cards", () => {
    expect(detect(args("card-1", rect(330, 60, 280, 80)))[0]?.id).toBe("card-2");
  });
});
