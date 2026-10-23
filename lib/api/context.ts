import type { Prisma } from "@prisma/client";

import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { type Ctx, userCtx } from "@/lib/services/context";
import { notFound, unauthorized } from "@/lib/services/errors";

/**
 * Build a service Ctx for the signed-in user from what a route knows: a
 * workspace slug, or the id of a resource inside a workspace.
 *
 * Each resolver finds the caller's membership in the resource's workspace in a
 * single query. No session → 401. Not a member, or no such resource → 404 with
 * the resource's own message, so another workspace's ids are indistinguishable
 * from ids that don't exist.
 */

async function requireUserId() {
  const session = await getSession();
  if (!session) throw unauthorized();
  return session.user.id;
}

async function ctxFor(
  workspace: Prisma.WorkspaceWhereInput,
  missing: string,
): Promise<Ctx> {
  const userId = await requireUserId();
  const membership = await db.membership.findFirst({
    where: { userId, workspace },
    select: { workspaceId: true, role: true },
  });
  if (!membership) throw notFound(missing);
  return userCtx(userId, membership.workspaceId, membership.role);
}

export const ctxForWorkspaceSlug = (slug: string) =>
  ctxFor({ slug }, "Workspace not found");

export const ctxForBoard = (boardId: string) =>
  ctxFor({ boards: { some: { id: boardId } } }, "Board not found");

export const ctxForColumn = (columnId: string) =>
  ctxFor(
    { boards: { some: { columns: { some: { id: columnId } } } } },
    "Column not found",
  );

export const ctxForTask = (taskId: string) =>
  ctxFor(
    {
      boards: {
        some: { columns: { some: { tasks: { some: { id: taskId } } } } },
      },
    },
    "Task not found",
  );

export const ctxForLabel = (labelId: string) =>
  ctxFor({ boards: { some: { labels: { some: { id: labelId } } } } }, "Label not found");
