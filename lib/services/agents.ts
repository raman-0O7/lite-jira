import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  type AgentConfig,
  assertWebhookUrl,
  type ClaudeCodeConfig,
  claudeCodeConfigSchema,
  decryptConfig,
  encryptConfig,
  type McpAgentConfig,
} from "@/lib/agents/config";
import { dispatchRun } from "@/lib/agents/dispatcher";
import { ACTIVE_RUN, failStaleRuns, recordRunActivity } from "@/lib/agents/lifecycle";
import { issueRepository } from "@/lib/agents/repo";
import { db } from "@/lib/db";
import { defer } from "@/lib/defer";
import { branchName } from "@/lib/github/branch";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { mintAgentToken } from "@/lib/services/api-tokens";
import { addComment } from "@/lib/services/comments";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { badRequest, forbidden, notFound, ServiceError } from "@/lib/services/errors";
import { moveToCategory } from "@/lib/services/github";
import { formatKey, parseKey } from "@/lib/services/issue-shapes";
import { getIssue } from "@/lib/services/issues";
import { projectScope } from "@/lib/services/scope";

/**
 * Agents as teammates (docs/features/12-agents.md): managing agents, assigning
 * issues to them (which dispatches a run), and the agent-side operations the
 * MCP tools expose (queue, claim, progress, release).
 */

// ---------- agents ----------

const agentSelect = {
  id: true,
  name: true,
  kind: true,
  enabled: true,
  createdAt: true,
  configEnc: true,
  owner: { select: { id: true, name: true, image: true } },
  _count: { select: { tokens: { where: { revokedAt: null } } } },
} satisfies Prisma.AgentSelect;

type AgentRow = Prisma.AgentGetPayload<{ select: typeof agentSelect }>;

/** Public shape: secrets never leave the server, only whether they're set. */
function toAgent(row: AgentRow) {
  const { configEnc, _count, ...agent } = row;
  const config = decryptConfig<AgentConfig>(configEnc);
  return {
    ...agent,
    tokenCount: _count.tokens,
    ...(agent.kind === "CLAUDE_CODE"
      ? { fireUrl: (config as ClaudeCodeConfig).fireUrl.replace(/trig_[A-Za-z0-9_-]+/, (t) => `${t.slice(0, 9)}…`) }
      : { webhookUrl: (config as McpAgentConfig).webhookUrl }),
  };
}

export async function listAgents(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  const rows = await db.agent.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
    select: agentSelect,
  });
  return rows.map(toAgent);
}

const name = z.string().trim().min(1, "Name is required").max(40);
const webhookUrl = z.string().trim().max(500).nullish();

const createAgentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CLAUDE_CODE"), name, ...claudeCodeConfigSchema.shape }),
  z.object({ kind: z.literal("MCP"), name, webhookUrl }),
]);

function ownerOf(ctx: Ctx) {
  if (ctx.actor.type !== "user") throw forbidden();
  return ctx.actor.userId;
}

async function assertNameFree(workspaceId: string, agentName: string, exceptId?: string) {
  const clash = await db.agent.findFirst({
    where: { workspaceId, name: { equals: agentName, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new ServiceError(409, `An agent named “${agentName}” already exists`);
}

/**
 * Create an agent owned by the caller. Returns secrets once: for an MCP agent,
 * its first token and the webhook signing secret.
 */
export async function createAgent(ctx: Ctx, input: unknown) {
  authorize(ctx, "agent.manage");
  const data = createAgentSchema.parse(input);
  const ownerUserId = ownerOf(ctx);
  await assertNameFree(ctx.workspaceId, data.name);

  const config: AgentConfig =
    data.kind === "CLAUDE_CODE"
      ? { fireUrl: data.fireUrl, token: data.token }
      : { webhookUrl: data.webhookUrl ? assertWebhookUrl(data.webhookUrl) : null, webhookSecret: randomBytes(32).toString("base64url") };

  return db.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: { workspaceId: ctx.workspaceId, name: data.name, kind: data.kind, ownerUserId, configEnc: encryptConfig(config) },
      select: { id: true, workspaceId: true, ownerUserId: true, name: true },
    });
    await recordActivity(tx, ctx, { action: "agent.created", data: { agentId: agent.id, name: agent.name, kind: data.kind } });
    const secrets =
      data.kind === "MCP"
        ? { token: (await mintAgentToken(tx, agent)).secret, webhookSecret: (config as McpAgentConfig).webhookSecret }
        : {};
    const row = await tx.agent.findUniqueOrThrow({ where: { id: agent.id }, select: agentSelect });
    return { agent: toAgent(row), secrets };
  });
}

async function findAgent(ctx: Ctx, id: string) {
  const agent = await db.agent.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, workspaceId: true, ownerUserId: true, name: true, kind: true, enabled: true, configEnc: true },
  });
  if (!agent) throw notFound("Agent not found");
  return agent;
}

const updateAgentSchema = z.object({
  name: name.optional(),
  enabled: z.boolean().optional(),
  fireUrl: claudeCodeConfigSchema.shape.fireUrl.optional(),
  token: claudeCodeConfigSchema.shape.token.optional(),
  webhookUrl,
});

export async function updateAgent(ctx: Ctx, id: string, input: unknown) {
  authorize(ctx, "agent.manage");
  const patch = updateAgentSchema.parse(input);
  const agent = await findAgent(ctx, id);
  if (patch.name) await assertNameFree(ctx.workspaceId, patch.name, id);

  const data: Prisma.AgentUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (agent.kind === "CLAUDE_CODE" && (patch.fireUrl || patch.token)) {
    const config = decryptConfig<ClaudeCodeConfig>(agent.configEnc);
    data.configEnc = encryptConfig({ fireUrl: patch.fireUrl ?? config.fireUrl, token: patch.token ?? config.token });
  }
  if (agent.kind === "MCP" && patch.webhookUrl !== undefined) {
    const config = decryptConfig<McpAgentConfig>(agent.configEnc);
    data.configEnc = encryptConfig({ ...config, webhookUrl: patch.webhookUrl ? assertWebhookUrl(patch.webhookUrl) : null });
  }

  return db.$transaction(async (tx) => {
    const row = await tx.agent.update({ where: { id }, data, select: agentSelect });
    const changed = Object.keys(patch).filter((k) => k !== "token");
    await recordActivity(tx, ctx, {
      action: "agent.updated",
      data: { agentId: id, fields: patch.token ? [...changed, "token"] : changed },
    });
    return toAgent(row);
  });
}

/** Delete an agent: its tokens and runs go with it; its issues become unassigned. */
export async function deleteAgent(ctx: Ctx, id: string) {
  authorize(ctx, "agent.manage");
  const agent = await findAgent(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.agent.delete({ where: { id } });
    await recordActivity(tx, ctx, { action: "agent.deleted", data: { agentId: id, name: agent.name } });
  });
}

export async function listAgentTokens(ctx: Ctx, id: string) {
  authorize(ctx, "agent.manage");
  await findAgent(ctx, id);
  return db.apiToken.findMany({
    where: { agentId: id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, prefix: true, lastUsedAt: true, createdAt: true },
  });
}

export async function createAgentToken(ctx: Ctx, id: string) {
  authorize(ctx, "agent.manage");
  const agent = await findAgent(ctx, id);
  return db.$transaction(async (tx) => {
    const minted = await mintAgentToken(tx, agent);
    await recordActivity(tx, ctx, { action: "agent.token_created", data: { agentId: id, tokenId: minted.token.id } });
    return minted;
  });
}

export async function revokeAgentToken(ctx: Ctx, id: string, tokenId: string) {
  authorize(ctx, "agent.manage");
  await findAgent(ctx, id);
  const { count } = await db.apiToken.updateMany({
    where: { id: tokenId, agentId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) throw notFound("Token not found");
}

// ---------- assignment & runs ----------

/** Cancel an issue's active runs (reassignment). */
/**
 * Claude Code works in a cloud copy of a repository, so it needs one to be
 * named: refuse the run up front rather than fire a routine that can't start.
 */
async function requireRepository(tx: Prisma.TransactionClient, issueId: string, kind: string, projectName: string) {
  if (kind !== "CLAUDE_CODE" || (await issueRepository(issueId, tx))) return;
  throw badRequest(
    `Connect a GitHub repository to ${projectName} first (Settings → Integrations), so Claude knows which code to work on.`,
  );
}

async function cancelActiveRuns(tx: Prisma.TransactionClient, issueId: string, reason: string) {
  await tx.agentRun.updateMany({
    where: { issueId, status: { in: ACTIVE_RUN } },
    data: { status: "CANCELLED", error: reason, finishedAt: new Date() },
  });
}

/**
 * Assign an issue to an agent (or clear the agent with null). Members and
 * above only. Assigning starts a run, dispatched after the response.
 */
export async function assignAgent(ctx: Ctx, issueId: string, input: unknown) {
  authorize(ctx, "agent.dispatch");
  const { agentId } = z.object({ agentId: z.string().min(1).nullable() }).parse(input);

  const runId = await db.$transaction(async (tx) => {
    const issue = await tx.issue.findFirst({
      where: { id: issueId, project: projectScope(ctx) },
      select: { id: true, projectId: true, assigneeAgentId: true, assigneeUserId: true, project: { select: { name: true } } },
    });
    if (!issue) throw notFound("Issue not found");
    if (agentId) {
      const agent = await tx.agent.findFirst({
        where: { id: agentId, workspaceId: ctx.workspaceId },
        select: { enabled: true, kind: true },
      });
      if (!agent) throw notFound("Agent not found");
      if (!agent.enabled) throw badRequest("That agent is disabled");
      // Re-assigning the same agent while it's working is a no-op.
      if (issue.assigneeAgentId === agentId) {
        const active = await tx.agentRun.count({ where: { issueId, agentId, status: { in: ACTIVE_RUN } } });
        if (active) return null;
      }
      await requireRepository(tx, issueId, agent.kind, issue.project.name);
    } else if (!issue.assigneeAgentId) {
      return null;
    }

    await cancelActiveRuns(tx, issueId, agentId ? "Reassigned" : "Unassigned");
    await tx.issue.update({
      where: { id: issueId },
      data: {
        assigneeAgentId: agentId,
        ...(agentId ? { assigneeUserId: null } : {}),
        claimedByAgentId: null,
        claimedAt: null,
      },
    });
    const changes: Prisma.InputJsonObject = {
      assigneeAgentId: { from: issue.assigneeAgentId, to: agentId },
      ...(agentId && issue.assigneeUserId ? { assigneeUserId: { from: issue.assigneeUserId, to: null } } : {}),
    };
    await recordActivity(tx, ctx, { action: "issue.updated", projectId: issue.projectId, issueId, data: { changes } });
    if (!agentId) return null;

    const run = await tx.agentRun.create({
      data: { workspaceId: ctx.workspaceId, issueId, agentId, requestedByUserId: actingUserId(ctx) },
      select: { id: true, agentId: true, issueId: true },
    });
    await recordRunActivity(tx, ctx, run, "agent.assigned");
    return run.id;
  });

  if (runId) defer("agents.dispatch", () => dispatchRun(runId));
  return { runId };
}

/** Start a new run for an issue still assigned to an agent whose last run ended. */
export async function retryAgentRun(ctx: Ctx, issueId: string) {
  authorize(ctx, "agent.dispatch");
  const runId = await db.$transaction(async (tx) => {
    const issue = await tx.issue.findFirst({
      where: { id: issueId, project: projectScope(ctx) },
      select: {
        id: true,
        assigneeAgentId: true,
        assigneeAgent: { select: { enabled: true, kind: true } },
        project: { select: { name: true } },
      },
    });
    if (!issue) throw notFound("Issue not found");
    if (!issue.assigneeAgentId || !issue.assigneeAgent) throw badRequest("This issue isn't assigned to an agent");
    if (!issue.assigneeAgent.enabled) throw badRequest("That agent is disabled");
    await requireRepository(tx, issueId, issue.assigneeAgent.kind, issue.project.name);
    if (await tx.agentRun.count({ where: { issueId, status: { in: ACTIVE_RUN } } })) {
      throw new ServiceError(409, "The agent is already working on this issue");
    }
    const run = await tx.agentRun.create({
      data: { workspaceId: ctx.workspaceId, issueId, agentId: issue.assigneeAgentId, requestedByUserId: actingUserId(ctx) },
      select: { id: true, agentId: true, issueId: true },
    });
    await recordRunActivity(tx, ctx, run, "agent.assigned", { retry: true });
    return run.id;
  });
  defer("agents.dispatch", () => dispatchRun(runId));
  return { runId };
}

/** An issue's recent runs, newest first (runs the watchdog first). */
export async function listAgentRuns(ctx: Ctx, issueId: string) {
  authorize(ctx, "project.read");
  const issue = await db.issue.findFirst({ where: { id: issueId, project: projectScope(ctx) }, select: { id: true } });
  if (!issue) throw notFound("Issue not found");
  await failStaleRuns();
  return db.agentRun.findMany({
    where: { issueId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      status: true,
      sessionUrl: true,
      prUrl: true,
      error: true,
      createdAt: true,
      dispatchedAt: true,
      claimedAt: true,
      finishedAt: true,
      agent: { select: { id: true, name: true, kind: true } },
      requestedBy: { select: { id: true, name: true, image: true } },
    },
  });
}

// ---------- agent side (MCP tools) ----------

type AgentIssue = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  assigneeAgentId: string | null;
  claimedByAgentId: string | null;
  project: { key: string };
  assigneeAgent: { id: string; ownerUserId: string; enabled: boolean; name: string } | null;
};

async function findAgentIssue(ctx: Ctx, key: string): Promise<AgentIssue> {
  const parsed = parseKey(key);
  const issue = parsed
    ? await db.issue.findFirst({
        where: { number: parsed.number, project: { ...projectScope(ctx), key: parsed.projectKey } },
        select: {
          id: true,
          projectId: true,
          number: true,
          title: true,
          assigneeAgentId: true,
          claimedByAgentId: true,
          project: { select: { key: true } },
          assigneeAgent: { select: { id: true, ownerUserId: true, enabled: true, name: true } },
        },
      })
    : null;
  if (!issue) throw notFound("Issue not found");
  return issue;
}

/**
 * The Ctx to act as the issue's agent. An agent token must be the assigned
 * agent; a user (OAuth or personal token) must own the assigned agent, and
 * from then on the agent is the actor.
 */
function agentCtxFor(ctx: Ctx, issue: AgentIssue): Ctx {
  const key = formatKey(issue.project.key, issue.number);
  const agent = issue.assigneeAgent;
  if (!agent) throw new ServiceError(409, `${key} isn't assigned to an agent`);
  if (!agent.enabled) throw new ServiceError(409, `${agent.name} is disabled`);
  if (ctx.actor.type === "agent") {
    if (ctx.actor.agentId !== agent.id) throw new ServiceError(409, `${key} is assigned to another agent`);
    return ctx;
  }
  if (ctx.actor.type === "user" && agent.ownerUserId === ctx.actor.userId) {
    return { ...ctx, actor: { type: "agent", agentId: agent.id, onBehalfOf: ctx.actor.userId } };
  }
  throw new ServiceError(409, `${key} is assigned to ${agent.name}, which isn't your agent`);
}

/** Issues assigned to the calling agent (or to the caller's agents) that aren't done. */
export async function listAgentQueue(ctx: Ctx) {
  authorize(ctx, "project.read");
  await failStaleRuns();
  const agentFilter: Prisma.IssueWhereInput =
    ctx.actor.type === "agent"
      ? { assigneeAgentId: ctx.actor.agentId }
      : { assigneeAgent: { ownerUserId: actingUserId(ctx) ?? "", enabled: true } };
  const issues = await db.issue.findMany({
    where: { ...agentFilter, project: projectScope(ctx), column: { category: { not: "DONE" } } },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 50,
    select: {
      number: true,
      title: true,
      priority: true,
      source: true,
      claimedByAgentId: true,
      project: { select: { key: true } },
      column: { select: { name: true } },
      assigneeAgent: { select: { name: true } },
      agentRuns: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
    },
  });
  return issues.map((i) => ({
    key: formatKey(i.project.key, i.number),
    title: i.title,
    priority: i.priority,
    status: i.column.name,
    agent: i.assigneeAgent?.name ?? null,
    run: i.agentRuns[0]?.status ?? null,
    claimed: i.claimedByAgentId !== null,
    fromGitHub: i.source === "GITHUB",
  }));
}

/** Lock the issue to its agent and start (or resume) the run. */
export async function claimIssue(ctx: Ctx, key: string) {
  authorize(ctx, "issue.write");
  const issue = await findAgentIssue(ctx, key);
  const agentCtx = agentCtxFor(ctx, issue);
  const agentId = issue.assigneeAgent!.id;

  const run = await db.$transaction(async (tx) => {
    const { count } = await tx.issue.updateMany({
      where: { id: issue.id, OR: [{ claimedByAgentId: null }, { claimedByAgentId: agentId }] },
      data: { claimedByAgentId: agentId, claimedAt: new Date() },
    });
    if (!count) throw new ServiceError(409, `${key} is claimed by another agent`);

    const current = await tx.agentRun.findFirst({
      where: { issueId: issue.id, agentId, status: { in: ACTIVE_RUN } },
      orderBy: { createdAt: "desc" },
    });
    const claimed =
      current && current.status !== "PR_OPEN"
        ? await tx.agentRun.update({
            where: { id: current.id },
            data: { status: "RUNNING", claimedAt: current.claimedAt ?? new Date() },
          })
        : (current ??
          (await tx.agentRun.create({
            data: { workspaceId: ctx.workspaceId, issueId: issue.id, agentId, status: "RUNNING", claimedAt: new Date() },
          })));
    if (!current || current.status === "QUEUED" || current.status === "DISPATCHED") {
      await recordRunActivity(tx, agentCtx, claimed, "agent.claimed");
    }
    return claimed;
  });

  await moveToCategory(agentCtx, issue.id, "IN_PROGRESS", ["TODO"]);
  return {
    issue: await getIssue(agentCtx, issue.id),
    run: { id: run.id, status: run.status },
    branch: branchName(key, issue.title),
    repository: await issueRepository(issue.id),
  };
}

const progressSchema = z.object({
  message: z.string().trim().min(1).max(10_000),
  status: z.enum(["working", "needs_input"]).optional(),
});

/** Post an update as the agent; optionally flag that it needs input. */
export async function reportProgress(ctx: Ctx, key: string, input: unknown) {
  authorize(ctx, "issue.write");
  const { message, status } = progressSchema.parse(input);
  const issue = await findAgentIssue(ctx, key);
  const agentCtx = agentCtxFor(ctx, issue);
  if (issue.claimedByAgentId !== issue.assigneeAgent!.id) throw new ServiceError(409, `Claim ${key} first`);

  const comment = await addComment(agentCtx, issue.id, { body: message });
  if (status) {
    const next = status === "needs_input" ? "NEEDS_INPUT" : "RUNNING";
    await db.$transaction(async (tx) => {
      const run = await tx.agentRun.findFirst({
        where: { issueId: issue.id, agentId: issue.assigneeAgent!.id, status: { in: ["RUNNING", "NEEDS_INPUT"] } },
        orderBy: { createdAt: "desc" },
      });
      if (!run || run.status === next) return;
      await tx.agentRun.update({ where: { id: run.id }, data: { status: next } });
      await recordRunActivity(tx, agentCtx, run, "agent.progress", { status: next });
    });
  }
  return { commentId: comment.id };
}

/** Give the issue back: the claim is cleared and the run ends as FAILED with the reason. */
export async function releaseIssue(ctx: Ctx, key: string, input: unknown) {
  authorize(ctx, "issue.write");
  const { reason } = z.object({ reason: z.string().trim().max(2000).optional() }).parse(input);
  const issue = await findAgentIssue(ctx, key);
  const agentCtx = agentCtxFor(ctx, issue);
  const agentId = issue.assigneeAgent!.id;
  if (issue.claimedByAgentId !== agentId) throw new ServiceError(409, `${key} isn't claimed by this agent`);

  if (reason) await addComment(agentCtx, issue.id, { body: reason });
  await db.$transaction(async (tx) => {
    await tx.issue.update({ where: { id: issue.id }, data: { claimedByAgentId: null, claimedAt: null } });
    const run = await tx.agentRun.findFirst({
      where: { issueId: issue.id, agentId, status: { in: ACTIVE_RUN } },
      orderBy: { createdAt: "desc" },
    });
    if (run) {
      await tx.agentRun.update({
        where: { id: run.id },
        data: { status: "FAILED", error: (reason || "Released by the agent").slice(0, 500), finishedAt: new Date() },
      });
    }
    await recordRunActivity(tx, agentCtx, run ?? { id: "", agentId, issueId: issue.id }, "agent.released", {
      ...(reason ? { reason: reason.slice(0, 500) } : {}),
    });
  });
  return { released: true };
}
