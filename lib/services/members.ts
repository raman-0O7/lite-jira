import type { Prisma, Role } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize, can } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { badRequest, forbidden, notFound } from "@/lib/services/errors";
import {
  memberProjectsSchema,
  updateMemberSchema,
} from "@/lib/validations/workspace";

/**
 * Workspace membership: listing, role changes, removal, leaving, and the
 * projects a guest can see. Rules: docs/features/08-members-invites.md.
 */

const PRIVILEGED: ReadonlySet<Role> = new Set(["OWNER", "ADMIN"]);

/**
 * Workspace members, for the members page and assignee pickers. Guests'
 * shared project ids are only included for callers who manage members.
 */
export async function listMembers(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  const showAccess = can(ctx, "members.manage");
  const memberships = await db.membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      createdAt: true,
      user: { select: { id: true, name: true, email: true, image: true } },
      projectAccess: { select: { projectId: true } },
    },
  });
  return memberships.map((m) => ({
    ...m.user,
    role: m.role,
    joinedAt: m.createdAt,
    projectIds:
      showAccess && m.role === "GUEST" ? m.projectAccess.map((a) => a.projectId) : [],
  }));
}

/**
 * Lock the workspace row for the rest of the transaction, so concurrent role
 * changes can't race past the last-owner guard.
 */
async function lockWorkspace(tx: Prisma.TransactionClient, workspaceId: string) {
  const rows = await tx.$queryRaw<{ personal: boolean }[]>`
    SELECT "personal" FROM "Workspace" WHERE "id" = ${workspaceId} FOR UPDATE`;
  return rows[0];
}

async function findMember(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  userId: string,
) {
  const member = await tx.membership.findFirst({
    where: { workspaceId: ctx.workspaceId, userId },
    select: { id: true, role: true, user: { select: { email: true } } },
  });
  if (!member) throw notFound("Member not found");
  return member;
}

const ownerCount = (tx: Prisma.TransactionClient, workspaceId: string) =>
  tx.membership.count({ where: { workspaceId, role: "OWNER" } });

/** Guests and people who leave can't hold assignments in the workspace. */
const unassign = (tx: Prisma.TransactionClient, workspaceId: string, userId: string) =>
  tx.issue.updateMany({
    where: { assigneeUserId: userId, project: { workspaceId } },
    data: { assigneeUserId: null },
  });

/**
 * Change a member's role. Admins manage members and guests; anything that
 * involves the ADMIN or OWNER role (granting or taking it away) needs an owner.
 */
export async function updateMemberRole(ctx: Ctx, userId: string, input: unknown) {
  authorize(ctx, "members.manage");
  const { role } = updateMemberSchema.parse(input);

  return db.$transaction(async (tx) => {
    const workspace = await lockWorkspace(tx, ctx.workspaceId);
    if (workspace.personal) {
      throw badRequest("A personal workspace has only one member");
    }
    const member = await findMember(tx, ctx, userId);
    if ((PRIVILEGED.has(role) || PRIVILEGED.has(member.role)) && ctx.role !== "OWNER") {
      throw forbidden("Only an owner can grant or change the admin and owner roles");
    }
    if (member.role === role) return { userId, role };
    if (member.role === "OWNER" && (await ownerCount(tx, ctx.workspaceId)) === 1) {
      throw badRequest("A workspace needs at least one owner");
    }

    await tx.membership.update({ where: { id: member.id }, data: { role } });
    if (role === "GUEST") await unassign(tx, ctx.workspaceId, userId);
    if (member.role === "GUEST") {
      // Full members see every project; the guest's list no longer applies.
      await tx.projectAccess.deleteMany({ where: { membershipId: member.id } });
    }
    await recordActivity(tx, ctx, {
      action: "member.role_changed",
      data: { userId, from: member.role, to: role },
    });
    return { userId, role };
  });
}

/** Remove someone else from the workspace. To remove yourself, leave. */
export async function removeMember(ctx: Ctx, userId: string) {
  authorize(ctx, "members.manage");
  if (userId === actingUserId(ctx)) {
    throw badRequest("To remove yourself, leave the workspace");
  }

  await db.$transaction(async (tx) => {
    await lockWorkspace(tx, ctx.workspaceId);
    const member = await findMember(tx, ctx, userId);
    if (PRIVILEGED.has(member.role) && ctx.role !== "OWNER") {
      throw forbidden("Only an owner can remove admins and owners");
    }
    await unassign(tx, ctx.workspaceId, userId);
    await tx.membership.delete({ where: { id: member.id } });
    await recordActivity(tx, ctx, {
      action: "member.removed",
      data: { userId, email: member.user.email, role: member.role },
    });
  });
}

/** Leave the ctx workspace. The last owner must hand over ownership first. */
export async function leaveWorkspace(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  const userId = actingUserId(ctx);
  if (ctx.actor.type !== "user" || !userId) {
    throw forbidden("Only a person can leave a workspace");
  }

  await db.$transaction(async (tx) => {
    const workspace = await lockWorkspace(tx, ctx.workspaceId);
    if (workspace.personal) throw badRequest("You can't leave your personal workspace");
    const member = await findMember(tx, ctx, userId);
    if (member.role === "OWNER" && (await ownerCount(tx, ctx.workspaceId)) === 1) {
      throw badRequest("Make someone else an owner before you leave");
    }
    await unassign(tx, ctx.workspaceId, userId);
    await tx.membership.delete({ where: { id: member.id } });
    await recordActivity(tx, ctx, {
      action: "member.left",
      data: { userId, role: member.role },
    });
  });
}

/** Replace the set of projects a guest can see. */
export async function setMemberProjects(ctx: Ctx, userId: string, input: unknown) {
  authorize(ctx, "members.manage");
  const projectIds = [...new Set(memberProjectsSchema.parse(input).projectIds)];

  return db.$transaction(async (tx) => {
    const member = await findMember(tx, ctx, userId);
    if (member.role !== "GUEST") {
      throw badRequest("Only guests have per-project access");
    }
    const found = await tx.project.count({
      where: { id: { in: projectIds }, workspaceId: ctx.workspaceId },
    });
    if (found !== projectIds.length) throw badRequest("Project not found");

    const current = await tx.projectAccess.findMany({
      where: { membershipId: member.id },
      select: { projectId: true },
    });
    const before = new Set(current.map((a) => a.projectId));
    const added = projectIds.filter((id) => !before.has(id));
    const removed = [...before].filter((id) => !projectIds.includes(id));
    if (added.length === 0 && removed.length === 0) return { userId, projectIds };

    await tx.projectAccess.deleteMany({
      where: { membershipId: member.id, projectId: { in: removed } },
    });
    await tx.projectAccess.createMany({
      data: added.map((projectId) => ({ projectId, membershipId: member.id })),
    });
    await recordActivity(tx, ctx, {
      action: "member.projects_changed",
      data: { userId, added, removed },
    });
    return { userId, projectIds };
  });
}

/** Name and email of a user, for "who am I" answers to token-based clients. */
export async function getProfile(userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true },
  });
  if (!user) throw notFound("User not found");
  return user;
}
