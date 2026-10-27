import { createHash, randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { badRequest, notFound, ServiceError } from "@/lib/services/errors";
import { projectScope } from "@/lib/services/scope";
import { createApiTokenSchema } from "@/lib/validations/api-token";

/**
 * Personal API tokens for the MCP server. The secret is shown once; the
 * database keeps its SHA-256. Rules: docs/features/10-mcp-server.md.
 */

export const API_TOKEN_PREFIX = "kanso_";
const MAX_ACTIVE = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
// lastUsedAt is a hint, not an audit log: write it at most once a minute.
const LAST_USED_GRANULARITY_MS = 60 * 1000;

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function randomBase62(length: number) {
  // 62 * 4 = 248 < 256: reject bytes ≥ 248 so every character is equally likely.
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < 248 && out.length < length) out += BASE62[byte % 62];
    }
  }
  return out;
}

export const hashApiToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const tokenSelect = {
  id: true,
  name: true,
  prefix: true,
  access: true,
  projectIds: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
} satisfies Prisma.ApiTokenSelect;

type TokenRow = Prisma.ApiTokenGetPayload<{ select: typeof tokenSelect }>;

const toToken = (token: TokenRow) => ({
  ...token,
  expired: token.expiresAt !== null && token.expiresAt.getTime() <= Date.now(),
});

const active = () => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
});

/** The caller's own tokens in the ctx workspace that haven't been revoked (expired ones flagged). */
export async function listApiTokens(ctx: Ctx) {
  authorize(ctx, "token.manage");
  const tokens = await db.apiToken.findMany({
    where: { workspaceId: ctx.workspaceId, userId: actingUserId(ctx) ?? "", agentId: null, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: tokenSelect,
  });
  return tokens.map(toToken);
}

/** Create a token. Returns the secret once, with the stored record. */
export async function createApiToken(ctx: Ctx, input: unknown) {
  authorize(ctx, "token.manage");
  const data = createApiTokenSchema.parse(input);
  const userId = actingUserId(ctx) ?? "";
  const projectIds = [...new Set(data.projectIds)];

  return db.$transaction(async (tx) => {
    const count = await tx.apiToken.count({
      where: { workspaceId: ctx.workspaceId, userId, agentId: null, ...active() },
    });
    if (count >= MAX_ACTIVE) {
      throw new ServiceError(409, `You can have at most ${MAX_ACTIVE} active tokens here.`);
    }
    if (projectIds.length > 0) {
      const visible = await tx.project.count({
        where: { AND: [{ id: { in: projectIds } }, projectScope(ctx)] },
      });
      if (visible !== projectIds.length) throw badRequest("Unknown project");
    }

    const secret = `${API_TOKEN_PREFIX}${randomBase62(40)}`;
    const token = await tx.apiToken.create({
      data: {
        userId,
        workspaceId: ctx.workspaceId,
        name: data.name,
        prefix: secret.slice(0, API_TOKEN_PREFIX.length + 6),
        tokenHash: hashApiToken(secret),
        access: data.access,
        projectIds,
        expiresAt:
          data.expiresInDays === null ? null : new Date(Date.now() + data.expiresInDays * DAY_MS),
      },
      select: tokenSelect,
    });
    await recordActivity(tx, ctx, {
      action: "api_token.created",
      data: { tokenId: token.id, name: token.name, access: token.access },
    });
    return { token: toToken(token), secret };
  });
}

/** Revoke one of the caller's tokens. */
export async function revokeApiToken(ctx: Ctx, tokenId: string) {
  authorize(ctx, "token.manage");
  return db.$transaction(async (tx) => {
    const { count } = await tx.apiToken.updateMany({
      where: {
        id: tokenId,
        workspaceId: ctx.workspaceId,
        userId: actingUserId(ctx) ?? "",
        agentId: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw notFound("Token not found");
    await recordActivity(tx, ctx, { action: "api_token.revoked", data: { tokenId } });
    return { ok: true };
  });
}

/**
 * Resolve a presented secret to a service Ctx, or null when it is unknown,
 * revoked, expired, or its owner is no longer a member of the workspace.
 * The role is read now, so a demotion applies to existing tokens immediately.
 */
export async function ctxForApiToken(secret: string): Promise<Ctx | null> {
  if (!secret.startsWith(API_TOKEN_PREFIX)) return null;
  const token = await db.apiToken.findUnique({
    where: { tokenHash: hashApiToken(secret) },
    select: {
      id: true,
      userId: true,
      workspaceId: true,
      access: true,
      projectIds: true,
      expiresAt: true,
      revokedAt: true,
      lastUsedAt: true,
      agent: { select: { id: true, enabled: true } },
    },
  });
  if (!token || token.revokedAt) return null;
  // An agent's token stops working the moment the agent is disabled.
  if (token.agent && !token.agent.enabled) return null;
  if (token.expiresAt && token.expiresAt.getTime() <= Date.now()) return null;

  const membership = await db.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: token.workspaceId, userId: token.userId } },
    select: { role: true },
  });
  if (!membership) return null;

  if (!token.lastUsedAt || Date.now() - token.lastUsedAt.getTime() > LAST_USED_GRANULARITY_MS) {
    await db.apiToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } });
  }

  return {
    actor: token.agent
      ? { type: "agent", agentId: token.agent.id, onBehalfOf: token.userId }
      : { type: "user", userId: token.userId },
    workspaceId: token.workspaceId,
    role: membership.role,
    via: "api_token",
    limits: {
      write: token.access === "WRITE",
      projectIds: token.projectIds.length > 0 ? token.projectIds : null,
    },
  };
}

/**
 * Mint a write token for an agent (Feature 12), held by the agent's owner.
 * Requests with it act as the agent. Returns the secret once.
 */
export async function mintAgentToken(
  tx: Prisma.TransactionClient,
  agent: { id: string; workspaceId: string; ownerUserId: string; name: string },
) {
  const secret = `${API_TOKEN_PREFIX}${randomBase62(40)}`;
  const token = await tx.apiToken.create({
    data: {
      userId: agent.ownerUserId,
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      name: `Agent: ${agent.name}`.slice(0, 100),
      prefix: secret.slice(0, API_TOKEN_PREFIX.length + 6),
      tokenHash: hashApiToken(secret),
      access: "WRITE",
    },
    select: { id: true, prefix: true, createdAt: true },
  });
  return { token, secret };
}
