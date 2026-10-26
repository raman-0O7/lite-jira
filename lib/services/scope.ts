import type { Prisma } from "@prisma/client";

import { actingUserId, type Ctx } from "@/lib/services/context";

/**
 * The projects the ctx actor can see: every project in the workspace, or for a
 * guest only those shared with them through ProjectAccess. Every project,
 * issue, comment, and label lookup filters through this, so an unshared
 * project is indistinguishable from one that doesn't exist.
 */
export function projectScope(ctx: Ctx): Prisma.ProjectWhereInput {
  if (ctx.role !== "GUEST") return { workspaceId: ctx.workspaceId };
  return {
    workspaceId: ctx.workspaceId,
    access: { some: { membership: { userId: actingUserId(ctx) ?? "" } } },
  };
}
