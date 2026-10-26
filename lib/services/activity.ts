import type { ActorType, Prisma } from "@prisma/client";

import type { Ctx } from "@/lib/services/context";

export type ActivityAction =
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "column.created"
  | "column.updated"
  | "column.deleted"
  | "column.reordered"
  | "issue.created"
  | "issue.updated"
  | "issue.moved"
  | "issue.deleted"
  | "label.created"
  | "label.updated"
  | "label.deleted"
  | "comment.added"
  | "comment.edited"
  | "comment.deleted"
  | "workspace.created"
  | "workspace.updated"
  | "invite.created"
  | "invite.revoked"
  | "invite.renewed"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "member.left"
  | "member.projects_changed";

type ActivityEntry = {
  action: ActivityAction;
  projectId?: string;
  issueId?: string;
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
      projectId: entry.projectId,
      issueId: entry.issueId,
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
