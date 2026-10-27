import type { Prisma } from "@prisma/client";

import { actingUserId, type Ctx } from "@/lib/services/context";

/**
 * The projects the ctx actor can see: every project in the workspace, or for a
 * guest only those shared with them through ProjectAccess — narrowed further
 * by a token's project list. Every project,
 * issue, comment, and label lookup filters through this, so an unshared
 * project is indistinguishable from one that doesn't exist.
 */
export function projectScope(ctx: Ctx): Prisma.ProjectWhereInput {
  const scope: Prisma.ProjectWhereInput = { workspaceId: ctx.workspaceId };
  if (ctx.role === "GUEST") {
    scope.access = { some: { membership: { userId: actingUserId(ctx) ?? "" } } };
  }
  // A project-limited token sees only its projects.
  if (ctx.limits?.projectIds) scope.id = { in: ctx.limits.projectIds };
  return scope;
}
