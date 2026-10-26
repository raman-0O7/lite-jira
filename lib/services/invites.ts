import { createHash, randomBytes } from "node:crypto";

import { Prisma, type Role } from "@prisma/client";

import { appUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { sendInviteEmail } from "@/lib/email";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { actingUserId, type Ctx, userCtx } from "@/lib/services/context";
import { badRequest, forbidden, notFound, ServiceError } from "@/lib/services/errors";
import { acceptInviteSchema, createInviteSchema } from "@/lib/validations/workspace";

/**
 * Workspace invites by email or link. The token appears only in the link; the
 * database keeps its SHA-256, so a leaked database can't be used to join.
 * Rules: docs/features/08-members-invites.md.
 */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

const inviteUrl = (token: string) => `${appUrl()}/invite/${token}`;
const expiry = () => new Date(Date.now() + INVITE_TTL_MS);

const inviteSelect = {
  id: true,
  email: true,
  role: true,
  projectIds: true,
  expiresAt: true,
  createdAt: true,
  invitedBy: { select: { id: true, name: true } },
} satisfies Prisma.InviteSelect;

type InviteRow = Prisma.InviteGetPayload<{ select: typeof inviteSelect }>;

const toInvite = (invite: InviteRow) => ({
  ...invite,
  expired: invite.expiresAt.getTime() <= Date.now(),
});

const pending = { acceptedAt: null, revokedAt: null } as const;

async function emailInvite(ctx: Ctx, email: string | null, token: string) {
  if (!email) return false;
  const [workspace, inviter] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { name: true } }),
    db.user.findUnique({ where: { id: actingUserId(ctx) ?? "" }, select: { name: true } }),
  ]);
  return sendInviteEmail({
    to: email,
    workspaceName: workspace.name,
    inviterName: inviter?.name || null,
    url: inviteUrl(token),
  });
}

/** Invites that haven't been accepted or revoked (expired ones included, flagged). */
export async function listInvites(ctx: Ctx) {
  authorize(ctx, "members.manage");
  const invites = await db.invite.findMany({
    where: { workspaceId: ctx.workspaceId, ...pending },
    orderBy: { createdAt: "desc" },
    select: inviteSelect,
  });
  return invites.map(toInvite);
}

export async function createInvite(ctx: Ctx, input: unknown) {
  authorize(ctx, "members.manage");
  const { email, role, projectIds: rawProjectIds } = createInviteSchema.parse(input);
  const projectIds = [...new Set(rawProjectIds)];
  if (role === "ADMIN" && ctx.role !== "OWNER") {
    throw forbidden("Only an owner can invite admins");
  }
  const { token, tokenHash } = newToken();

  const invite = await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { personal: true },
    });
    if (workspace.personal) {
      throw badRequest(
        "Your personal workspace is just for you. Create a team workspace to invite people.",
      );
    }
    if (email) {
      const member = await tx.membership.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          user: { email: { equals: email, mode: "insensitive" } },
        },
        select: { id: true },
      });
      if (member) throw new ServiceError(409, `${email} is already a member`);
      const existing = await tx.invite.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          email,
          ...pending,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ServiceError(409, `${email} already has a pending invite`);
      }
    }
    const found = await tx.project.count({
      where: { id: { in: projectIds }, workspaceId: ctx.workspaceId },
    });
    if (found !== projectIds.length) throw badRequest("Project not found");

    const created = await tx.invite.create({
      data: {
        workspaceId: ctx.workspaceId,
        email,
        role,
        projectIds,
        tokenHash,
        invitedById: actingUserId(ctx),
        expiresAt: expiry(),
      },
      select: inviteSelect,
    });
    await recordActivity(tx, ctx, {
      action: "invite.created",
      data: { inviteId: created.id, email, role, projectIds },
    });
    return created;
  });

  const emailSent = await emailInvite(ctx, email, token);
  return { invite: toInvite(invite), url: inviteUrl(token), emailSent };
}

async function findPendingInvite(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  inviteId: string,
) {
  const invite = await tx.invite.findFirst({
    where: { id: inviteId, workspaceId: ctx.workspaceId, ...pending },
    select: { id: true, email: true, role: true },
  });
  if (!invite) throw notFound("Invite not found");
  return invite;
}

export async function revokeInvite(ctx: Ctx, inviteId: string) {
  authorize(ctx, "members.manage");
  await db.$transaction(async (tx) => {
    const invite = await findPendingInvite(tx, ctx, inviteId);
    await tx.invite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
    await recordActivity(tx, ctx, {
      action: "invite.revoked",
      data: { inviteId, email: invite.email, role: invite.role },
    });
  });
}

/** Issue a fresh link (and expiry) for a pending invite; the old link stops working. */
export async function renewInvite(ctx: Ctx, inviteId: string) {
  authorize(ctx, "members.manage");
  const { token, tokenHash } = newToken();
  const invite = await db.$transaction(async (tx) => {
    const before = await findPendingInvite(tx, ctx, inviteId);
    if (before.role === "ADMIN" && ctx.role !== "OWNER") {
      throw forbidden("Only an owner can invite admins");
    }
    const renewed = await tx.invite.update({
      where: { id: inviteId },
      data: { tokenHash, expiresAt: expiry() },
      select: inviteSelect,
    });
    await recordActivity(tx, ctx, {
      action: "invite.renewed",
      data: { inviteId, email: before.email },
    });
    return renewed;
  });
  const emailSent = await emailInvite(ctx, invite.email, token);
  return { invite: toInvite(invite), url: inviteUrl(token), emailSent };
}

export type InviteStatus = "valid" | "expired" | "used" | "revoked";

export type InvitePreview = {
  status: InviteStatus;
  workspace: { name: string; slug: string };
  role: Role;
  email: string | null;
  invitedBy: string | null;
};

async function findByToken(token: string) {
  return db.invite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      projectIds: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      workspaceId: true,
      workspace: { select: { name: true, slug: true } },
      invitedBy: { select: { name: true } },
    },
  });
}

function statusOf(invite: {
  acceptedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.acceptedAt) return "used";
  if (invite.expiresAt.getTime() <= Date.now()) return "expired";
  return "valid";
}

/** What the invite page shows: anyone holding the token may see this. Null if unknown. */
export async function getInvitePreview(token: string): Promise<InvitePreview | null> {
  const invite = await findByToken(token);
  if (!invite) return null;
  return {
    status: statusOf(invite),
    workspace: invite.workspace,
    role: invite.role,
    email: invite.email,
    invitedBy: invite.invitedBy?.name || null,
  };
}

const REFUSALS: Record<Exclude<InviteStatus, "valid">, string> = {
  revoked: "This invite was revoked",
  used: "This invite has already been used",
  expired: "This invite has expired. Ask for a new one.",
};

/**
 * Join a workspace with an invite token. Single use and atomic: the invite is
 * claimed with a conditional update, so two people can't both use one link.
 * A user who is already a member is sent on without using the invite up.
 */
export async function acceptInvite(
  user: { id: string; email: string },
  input: unknown,
): Promise<{ slug: string }> {
  const { token } = acceptInviteSchema.parse(input);
  const invite = await findByToken(token);
  if (!invite) throw notFound("This invite link isn't valid");

  const status = statusOf(invite);
  if (status !== "valid") throw badRequest(REFUSALS[status]);
  if (invite.email && invite.email !== user.email.toLowerCase()) {
    throw forbidden(
      `This invite is for ${invite.email}. Sign in with that email to accept it.`,
    );
  }

  const existing = await db.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: invite.workspaceId, userId: user.id } },
    select: { id: true },
  });
  if (existing) return { slug: invite.workspace.slug };

  try {
    await db.$transaction(async (tx) => {
      const claimed = await tx.invite.updateMany({
        where: { id: invite.id, ...pending, expiresAt: { gt: new Date() } },
        data: { acceptedAt: new Date(), acceptedById: user.id },
      });
      if (claimed.count === 0) throw new ServiceError(409, REFUSALS.used);

      const membership = await tx.membership.create({
        data: { workspaceId: invite.workspaceId, userId: user.id, role: invite.role },
        select: { id: true },
      });
      if (invite.role === "GUEST" && invite.projectIds.length > 0) {
        // Projects deleted since the invite was sent are skipped.
        const projects = await tx.project.findMany({
          where: { id: { in: invite.projectIds }, workspaceId: invite.workspaceId },
          select: { id: true },
        });
        await tx.projectAccess.createMany({
          data: projects.map((p) => ({ projectId: p.id, membershipId: membership.id })),
        });
      }
      await recordActivity(tx, userCtx(user.id, invite.workspaceId, invite.role), {
        action: "member.joined",
        data: { userId: user.id, inviteId: invite.id, role: invite.role },
      });
    });
  } catch (error) {
    // Joined concurrently through another invite: they're a member either way.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return { slug: invite.workspace.slug };
    }
    throw error;
  }
  return { slug: invite.workspace.slug };
}
