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
  return (await requireApiUser()).id;
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

export const ctxForProject = (projectId: string) =>
  ctxFor({ projects: { some: { id: projectId } } }, "Project not found");

export const ctxForColumn = (columnId: string) =>
  ctxFor(
    { projects: { some: { columns: { some: { id: columnId } } } } },
    "Column not found",
  );

export const ctxForIssue = (issueId: string) =>
  ctxFor({ projects: { some: { issues: { some: { id: issueId } } } } }, "Issue not found");

export const ctxForLabel = (labelId: string) =>
  ctxFor({ projects: { some: { labels: { some: { id: labelId } } } } }, "Label not found");

export const ctxForComment = (commentId: string) =>
  ctxFor(
    {
      projects: {
        some: { issues: { some: { comments: { some: { id: commentId } } } } },
      },
    },
    "Comment not found",
  );

export const ctxForAttachment = (attachmentId: string) =>
  ctxFor(
    {
      projects: {
        some: { issues: { some: { comments: { some: { attachments: { some: { id: attachmentId } } } } } } },
      },
    },
    "Attachment not found",
  );

export const ctxForInvite = (inviteId: string) =>
  ctxFor({ invites: { some: { id: inviteId } } }, "Invite not found");

/** The signed-in user (id and email), or a 401. For routes that act before a Ctx exists. */
export async function requireApiUser() {
  const session = await getSession();
  if (!session) throw unauthorized();
  return session.user;
}
