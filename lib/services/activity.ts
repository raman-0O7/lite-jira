import type { ActorType, Prisma } from "@prisma/client";

import type { Ctx } from "@/lib/services/context";

export type ActivityAction =
  | "board.created"
  | "board.renamed"
  | "board.deleted"
  | "column.created"
  | "column.renamed"
  | "column.deleted"
  | "column.reordered"
  | "task.created"
  | "task.updated"
  | "task.moved"
  | "task.deleted"
  | "label.created"
  | "label.updated"
  | "label.deleted";

type ActivityEntry = {
  action: ActivityAction;
  boardId?: string;
  taskId?: string;
  data?: Prisma.InputJsonObject;
};

const ACTOR_TYPE: Record<Ctx["actor"]["type"], ActorType> = {
  user: "USER",
  agent: "AGENT",
  github: "GITHUB",
  system: "SYSTEM",
};

/**
 * Append an activity row. Must be called with the same transaction client as
 * the write it describes, so history and data can never disagree.
 *
 * Agents record both themselves (`actorAgentId`) and the user they act for
 * (`actorUserId`), so "Claude, on behalf of Raman" is reconstructable.
 */
export async function recordActivity(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  entry: ActivityEntry,
) {
  const { actor } = ctx;
  await tx.activity.create({
    data: {
      workspaceId: ctx.workspaceId,
      boardId: entry.boardId,
      taskId: entry.taskId,
      action: entry.action,
      data: { ...entry.data, via: ctx.via },
      actorType: ACTOR_TYPE[actor.type],
      actorUserId:
        actor.type === "user"
          ? actor.userId
          : actor.type === "agent"
            ? actor.onBehalfOf
            : null,
      actorAgentId: actor.type === "agent" ? actor.agentId : null,
    },
  });
}
