import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";
import { z } from "zod";

import {
  type AgentConfig,
  assertWebhookUrl,
  type ClaudeApiConfig,
  type ClaudeCodeConfig,
  claudeCodeConfigSchema,
  decryptConfig,
  encryptConfig,
  type McpAgentConfig,
  WORKSPACE_AGENT_MODELS,
} from "@/lib/agents/config";
import { hashClaimCode } from "@/lib/agents/claim-code";
import {
  DEFINITION_VERSION,
  provisionWorkspaceAgent,
  reconcileActiveRuns,
  updateAgentDefinition,
  workspaceAgentSpend,
} from "@/lib/agents/claude-api";
import { describeAnthropicError, interruptRunSessions } from "@/lib/agents/claude-api-client";
import { dispatchRun } from "@/lib/agents/dispatcher";
import { PULL_REQUEST_PERMISSIONS, repoAccessToken, workspaceAgentGitHub } from "@/lib/agents/github-access";
import { DispatchError } from "@/lib/agents/http";
import { ACTIVE_RUN, failStaleRuns, onPullRequestLinked, recordRunActivity } from "@/lib/agents/lifecycle";
import { issueRepository } from "@/lib/agents/repo";
import { db } from "@/lib/db";
import { defer } from "@/lib/defer";
import { branchName } from "@/lib/github/branch";
import { createPullRequest, getRepo, GitHubError } from "@/lib/github/client";
import { authorize, can } from "@/lib/permissions";
import { isServerOwner } from "@/lib/server-owner";
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

const hint = (secret: string) => `…${secret.slice(-4)}`;

/** The workspace agent's settings, for admins: secrets only as their last 4 characters. */
function workspaceAgentSettings(config: ClaudeApiConfig) {
  return {
    apiKeyHint: hint(config.apiKey),
    model: config.model,
    monthlyLimitCents: config.monthlyLimitCents,
    runLimitCents: config.runLimitCents,
    consoleWorkspaceId: config.consoleWorkspaceId,
  };
}

type PublicAgent = Omit<AgentRow, "configEnc" | "_count"> & {
  tokenCount: number;
  fireUrl?: string;
  webhookUrl?: string | null;
  workspaceAgent?: ReturnType<typeof workspaceAgentSettings>;
};

/** Public shape: secrets never leave the server, only whether they're set. */
function toAgent(row: AgentRow): PublicAgent {
  const { configEnc, _count, ...agent } = row;
  const config = decryptConfig<AgentConfig>(configEnc);
  return {
    ...agent,
    tokenCount: _count.tokens,
    ...(agent.kind === "CLAUDE_CODE"
      ? { fireUrl: (config as ClaudeCodeConfig).fireUrl.replace(/trig_[A-Za-z0-9_-]+/, (t) => `${t.slice(0, 9)}…`) }
      : agent.kind === "MCP"
        ? { webhookUrl: (config as McpAgentConfig).webhookUrl }
        : { workspaceAgent: workspaceAgentSettings(config as ClaudeApiConfig) }),
  };
}

/**
 * Admins see every agent. Others see their own and the shared ones (MCP
 * agents, the workspace agent): a teammate's Claude Code agent is theirs alone
 * (only they can start it). Only admins see the workspace agent's settings and
 * spend.
 */
export async function listAgents(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  const admin = can(ctx, "agent.manage");
  const scope: Prisma.AgentWhereInput = admin
    ? {}
    : { OR: [{ ownerUserId: actingUserId(ctx) ?? "" }, { kind: { in: ["MCP", "CLAUDE_API"] } }] };
  const rows = await db.agent.findMany({
    where: { workspaceId: ctx.workspaceId, ...scope },
    orderBy: { createdAt: "asc" },
    select: agentSelect,
  });
  return Promise.all(
    rows.map(async (row) => {
      const agent = toAgent(row);
      if (agent.kind !== "CLAUDE_API") return agent;
      if (!admin) return { ...agent, workspaceAgent: undefined };
      return { ...agent, spend: await workspaceAgentSpend(agent.id) };
    }),
  );
}

/**
 * Whether Kanso's GitHub App can push and open pull requests for the
 * workspace agent, and who can fix it if not (admins, Settings → Agents).
 */
export async function getWorkspaceAgentGitHub(ctx: Ctx) {
  authorize(ctx, "agent.manage");
  const github = await workspaceAgentGitHub(ctx.workspaceId);
  if (github.status !== "app_needs_access") return github;
  // Only whoever runs Kanso can change the app's own settings.
  return (await isServerOwner(actingUserId(ctx))) ? github : { status: github.status, settingsUrl: null };
}

const name = z.string().trim().min(1, "Name is required").max(40);
const webhookUrl = z.string().trim().max(500).nullish();

// The workspace agent (docs/features/18-workspace-agent.md "Setup").
const apiKey = z
  .string()
  .trim()
  .max(300)
  .regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, "Paste a Claude API key (sk-ant-…) from the Claude Console");
const limit = z.coerce.number().min(1, "Limits start at $1").max(100_000);
const consoleWorkspaceId = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9_-]*$/, "That doesn't look like a Console workspace ID")
  .nullish();
const workspaceAgentModel = z.enum(WORKSPACE_AGENT_MODELS);

const createAgentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("CLAUDE_CODE"), name, ...claudeCodeConfigSchema.shape }),
  z.object({ kind: z.literal("MCP"), name, webhookUrl }),
  z.object({
    kind: z.literal("CLAUDE_API"),
    name,
    apiKey,
    model: workspaceAgentModel.default("claude-opus-5-5"),
    monthlyLimit: limit.default(100),
    runLimit: limit.default(25),
    consoleWorkspaceId,
  }),
]);

/** Shown once at creation: an MCP agent's first token and webhook signing secret. */
type AgentSecrets = { token?: string; webhookSecret?: string };

const toCents = (value: number) => Math.round(value * 100);

/** An Anthropic failure while provisioning, as a safe message. */
function provisioningError(error: unknown) {
  const { status, message } = describeAnthropicError(error);
  if (status === 401) return badRequest("Claude rejected that API key");
  if (status === 403) return badRequest(message);
  return new ServiceError(502, `Couldn't set up the agent on Claude: ${message.toLowerCase()}`);
}

async function revokeToken(tokenId: string) {
  await db.apiToken.updateMany({ where: { id: tokenId, revokedAt: null }, data: { revokedAt: new Date() } });
}

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
 * Create an agent owned by the caller (members and up: each connects their
 * own). Returns secrets once: for an MCP agent, its first token and the
 * webhook signing secret.
 */
export async function createAgent(ctx: Ctx, input: unknown) {
  authorize(ctx, "agent.create");
  const data = createAgentSchema.parse(input);
  if (data.kind === "CLAUDE_API") return createWorkspaceAgent(ctx, data);
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
    const secrets: AgentSecrets =
      data.kind === "MCP"
        ? { token: (await mintAgentToken(tx, agent)).secret, webhookSecret: (config as McpAgentConfig).webhookSecret }
        : {};
    const row = await tx.agent.findUniqueOrThrow({ where: { id: agent.id }, select: agentSelect });
    return { agent: toAgent(row), secrets };
  });
}

/**
 * Connect the workspace agent (admins, one per workspace): the row and its
 * Kanso token first, then the Anthropic side; if that fails the row goes.
 */
async function createWorkspaceAgent(ctx: Ctx, data: Extract<z.infer<typeof createAgentSchema>, { kind: "CLAUDE_API" }>) {
  authorize(ctx, "agent.manage");
  const ownerUserId = ownerOf(ctx);
  if (await db.agent.count({ where: { workspaceId: ctx.workspaceId, kind: "CLAUDE_API" } })) {
    throw new ServiceError(409, "This workspace already has a workspace agent");
  }
  if (data.runLimit > data.monthlyLimit) throw badRequest("The per-run limit can't be more than the monthly limit");
  await assertNameFree(ctx.workspaceId, data.name);
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { slug: true } });

  const base: ClaudeApiConfig = {
    apiKey: data.apiKey,
    model: data.model,
    monthlyLimitCents: toCents(data.monthlyLimit),
    runLimitCents: toCents(data.runLimit),
    consoleWorkspaceId: data.consoleWorkspaceId || null,
    environmentId: "",
    anthropicAgentId: "",
    anthropicAgentVersion: 0,
    vaultId: "",
    vaultTokenId: "",
    definitionVersion: DEFINITION_VERSION,
  };
  // Disabled until provisioned, so nobody can assign it half set up.
  const { agent, minted } = await db.$transaction(async (tx) => {
    const agent = await tx.agent.create({
      data: { workspaceId: ctx.workspaceId, name: data.name, kind: "CLAUDE_API", ownerUserId, enabled: false, configEnc: encryptConfig(base) },
      select: { id: true, workspaceId: true, ownerUserId: true, name: true },
    });
    return { agent, minted: await mintAgentToken(tx, agent) };
  });

  let config: ClaudeApiConfig;
  try {
    const provisioned = await provisionWorkspaceAgent({
      apiKey: data.apiKey,
      model: data.model,
      name: data.name,
      workspaceSlug: workspace.slug,
      mcpToken: minted.secret,
    });
    config = { ...base, ...provisioned, vaultTokenId: minted.token.id };
  } catch (error) {
    await db.agent.delete({ where: { id: agent.id } });
    throw provisioningError(error);
  }

  return db.$transaction(async (tx) => {
    const row = await tx.agent.update({
      where: { id: agent.id },
      data: { enabled: true, configEnc: encryptConfig(config) },
      select: agentSelect,
    });
    await recordActivity(tx, ctx, { action: "agent.created", data: { agentId: agent.id, name: agent.name, kind: "CLAUDE_API" } });
    const secrets: AgentSecrets = {};
    return { agent: toAgent(row), secrets };
  });
}

const updateWorkspaceAgentSchema = z.object({
  name: name.optional(),
  enabled: z.boolean().optional(),
  apiKey: apiKey.optional(),
  model: workspaceAgentModel.optional(),
  monthlyLimit: limit.optional(),
  runLimit: limit.optional(),
  consoleWorkspaceId,
});

/**
 * Change the workspace agent (admins). A new API key provisions afresh (it may
 * belong to another organization) with a new Kanso token; a new model
 * publishes a new agent version. Disabling it cancels its runs.
 */
async function updateWorkspaceAgent(ctx: Ctx, agent: { id: string; name: string; configEnc: string }, input: unknown) {
  authorize(ctx, "agent.manage");
  const patch = updateWorkspaceAgentSchema.parse(input);
  if (patch.name) await assertNameFree(ctx.workspaceId, patch.name, agent.id);
  const current = decryptConfig<ClaudeApiConfig>(agent.configEnc);
  const agentName = patch.name ?? agent.name;
  let config: ClaudeApiConfig = {
    ...current,
    ...(patch.model ? { model: patch.model } : {}),
    ...(patch.monthlyLimit !== undefined ? { monthlyLimitCents: toCents(patch.monthlyLimit) } : {}),
    ...(patch.runLimit !== undefined ? { runLimitCents: toCents(patch.runLimit) } : {}),
    ...(patch.consoleWorkspaceId !== undefined ? { consoleWorkspaceId: patch.consoleWorkspaceId || null } : {}),
  };
  if (config.runLimitCents > config.monthlyLimitCents) throw badRequest("The per-run limit can't be more than the monthly limit");

  let oldTokenId: string | null = null;
  if (patch.apiKey && patch.apiKey !== current.apiKey) {
    const owner = await db.agent.findUniqueOrThrow({ where: { id: agent.id }, select: { id: true, workspaceId: true, ownerUserId: true, name: true } });
    const minted = await db.$transaction((tx) => mintAgentToken(tx, owner));
    const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { slug: true } });
    try {
      const provisioned = await provisionWorkspaceAgent({
        apiKey: patch.apiKey,
        model: config.model,
        name: agentName,
        workspaceSlug: workspace.slug,
        mcpToken: minted.secret,
      });
      config = { ...config, ...provisioned, apiKey: patch.apiKey, vaultTokenId: minted.token.id, definitionVersion: DEFINITION_VERSION };
      oldTokenId = current.vaultTokenId || null;
    } catch (error) {
      await revokeToken(minted.token.id);
      throw provisioningError(error);
    }
  } else if (patch.model && patch.model !== current.model) {
    try {
      config.anthropicAgentVersion = await updateAgentDefinition(config, agentName);
      config.definitionVersion = DEFINITION_VERSION;
    } catch (error) {
      throw provisioningError(error);
    }
  }

  const cancelled: string[] = [];
  const result = await db.$transaction(async (tx) => {
    if (patch.enabled === false) {
      const active = await tx.agentRun.findMany({ where: { agentId: agent.id, status: { in: ACTIVE_RUN } }, select: { id: true } });
      cancelled.push(...active.map((r) => r.id));
      await tx.agentRun.updateMany({
        where: { id: { in: cancelled } },
        data: { status: "CANCELLED", error: "The agent was disabled", finishedAt: new Date() },
      });
    }
    const row = await tx.agent.update({
      where: { id: agent.id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        configEnc: encryptConfig(config),
      },
      select: agentSelect,
    });
    // Field names only: never the secrets themselves.
    await recordActivity(tx, ctx, { action: "agent.updated", data: { agentId: agent.id, fields: Object.keys(patch) } });
    return toAgent(row);
  });
  if (oldTokenId) await revokeToken(oldTokenId);
  if (cancelled.length) defer("agents.interrupt", () => interruptRunSessions(cancelled));
  return result;
}

async function findAgent(ctx: Ctx, id: string) {
  const agent = await db.agent.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, workspaceId: true, ownerUserId: true, name: true, kind: true, enabled: true, configEnc: true },
  });
  if (!agent) throw notFound("Agent not found");
  return agent;
}

/** An agent the caller may change: their own, or anyone's for admins. */
async function findManagedAgent(ctx: Ctx, id: string) {
  authorize(ctx, "agent.create");
  const agent = await findAgent(ctx, id);
  if (agent.ownerUserId !== actingUserId(ctx) && !can(ctx, "agent.manage")) throw forbidden();
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
  const agent = await findManagedAgent(ctx, id);
  if (agent.kind === "CLAUDE_API") return updateWorkspaceAgent(ctx, agent, input);
  const patch = updateAgentSchema.parse(input);
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
  const agent = await findManagedAgent(ctx, id);
  if (agent.kind === "CLAUDE_API") {
    authorize(ctx, "agent.manage");
    // Its runs go with it, so stop their sessions first.
    const active = await db.agentRun.findMany({ where: { agentId: id, status: { in: ACTIVE_RUN } }, select: { id: true } });
    await interruptRunSessions(active.map((r) => r.id));
  }
  await db.$transaction(async (tx) => {
    await tx.agent.delete({ where: { id } });
    await recordActivity(tx, ctx, { action: "agent.deleted", data: { agentId: id, name: agent.name } });
  });
}

export async function listAgentTokens(ctx: Ctx, id: string) {
  await findManagedAgent(ctx, id);
  return db.apiToken.findMany({
    where: { agentId: id, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, prefix: true, lastUsedAt: true, createdAt: true },
  });
}

export async function createAgentToken(ctx: Ctx, id: string) {
  const agent = await findManagedAgent(ctx, id);
  return db.$transaction(async (tx) => {
    const minted = await mintAgentToken(tx, agent);
    await recordActivity(tx, ctx, { action: "agent.token_created", data: { agentId: id, tokenId: minted.token.id } });
    return minted;
  });
}

export async function revokeAgentToken(ctx: Ctx, id: string, tokenId: string) {
  await findManagedAgent(ctx, id);
  const { count } = await db.apiToken.updateMany({
    where: { id: tokenId, agentId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (!count) throw notFound("Token not found");
}

// ---------- assignment & runs ----------

/**
 * Claude Code and the workspace agent work in a cloud copy of a repository,
 * so it needs one to be named: refuse the run up front rather than start a
 * session that can't work.
 */
async function requireRepository(tx: Prisma.TransactionClient, issueId: string, kind: string, projectName: string) {
  if (kind === "MCP" || (await issueRepository(issueId, tx))) return;
  throw badRequest(
    `Connect a GitHub repository to ${projectName} first (Settings → Integrations), so Claude knows which code to work on.`,
  );
}

/** Cancel an issue's active runs (reassignment). Returns their ids, to interrupt sessions after commit. */
async function cancelActiveRuns(tx: Prisma.TransactionClient, issueId: string, reason: string) {
  const active = await tx.agentRun.findMany({ where: { issueId, status: { in: ACTIVE_RUN } }, select: { id: true } });
  await tx.agentRun.updateMany({
    where: { id: { in: active.map((r) => r.id) } },
    data: { status: "CANCELLED", error: reason, finishedAt: new Date() },
  });
  return active.map((r) => r.id);
}

/**
 * A Claude Code routine runs on its owner's Claude account, and only they can
 * open its session to answer it, so only they can start it.
 */
function assertCanStart(ctx: Ctx, agent: { kind: string; ownerUserId: string; name: string; owner: { name: string } }) {
  if (agent.kind !== "CLAUDE_CODE" || agent.ownerUserId === actingUserId(ctx)) return;
  throw new ServiceError(
    403,
    `Only ${agent.owner.name} can start ${agent.name}: it runs on their Claude account. Connect your own Claude in Settings → Agents.`,
  );
}

/**
 * Hand an issue to an agent (or take it off with null). Members and above
 * only; a Claude Code agent only by its owner. The person stays the assignee:
 * the agent's owner for Claude Code, else whoever had it (or the caller).
 * Assigning starts a run, dispatched after the response.
 */
export async function assignAgent(ctx: Ctx, issueId: string, input: unknown) {
  authorize(ctx, "agent.dispatch");
  const { agentId } = z.object({ agentId: z.string().min(1).nullable() }).parse(input);

  const cancelled: string[] = [];
  const runId = await db.$transaction(async (tx) => {
    const issue = await tx.issue.findFirst({
      where: { id: issueId, project: projectScope(ctx) },
      select: { id: true, projectId: true, assigneeAgentId: true, assigneeUserId: true, project: { select: { name: true } } },
    });
    if (!issue) throw notFound("Issue not found");
    let person = issue.assigneeUserId;
    if (agentId) {
      const agent = await tx.agent.findFirst({
        where: { id: agentId, workspaceId: ctx.workspaceId },
        select: { enabled: true, kind: true, name: true, ownerUserId: true, owner: { select: { name: true } } },
      });
      if (!agent) throw notFound("Agent not found");
      if (!agent.enabled) throw badRequest("That agent is disabled");
      assertCanStart(ctx, agent);
      // Re-assigning the same agent while it's working is a no-op.
      if (issue.assigneeAgentId === agentId) {
        const active = await tx.agentRun.count({ where: { issueId, agentId, status: { in: ACTIVE_RUN } } });
        if (active) return null;
      }
      await requireRepository(tx, issueId, agent.kind, issue.project.name);
      person = agent.kind === "CLAUDE_CODE" ? agent.ownerUserId : (person ?? actingUserId(ctx) ?? null);
    } else if (!issue.assigneeAgentId) {
      return null;
    }

    cancelled.push(...(await cancelActiveRuns(tx, issueId, agentId ? "Reassigned" : "Unassigned")));
    await tx.issue.update({
      where: { id: issueId },
      data: { assigneeAgentId: agentId, assigneeUserId: person, claimedByAgentId: null, claimedAt: null },
    });
    const changes: Prisma.InputJsonObject = {
      assigneeAgentId: { from: issue.assigneeAgentId, to: agentId },
      ...(person !== issue.assigneeUserId ? { assigneeUserId: { from: issue.assigneeUserId, to: person } } : {}),
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

  if (cancelled.length) defer("agents.interrupt", () => interruptRunSessions(cancelled));
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
        assigneeAgent: { select: { enabled: true, kind: true, name: true, ownerUserId: true, owner: { select: { name: true } } } },
        project: { select: { name: true } },
      },
    });
    if (!issue) throw notFound("Issue not found");
    if (!issue.assigneeAgentId || !issue.assigneeAgent) throw badRequest("This issue isn't assigned to an agent");
    if (!issue.assigneeAgent.enabled) throw badRequest("That agent is disabled");
    assertCanStart(ctx, issue.assigneeAgent);
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
  await reconcileActiveRuns({ issueId });
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
      costCents: true,
      budgetCents: true,
      createdAt: true,
      dispatchedAt: true,
      claimedAt: true,
      finishedAt: true,
      agent: { select: { id: true, name: true, kind: true, owner: { select: { id: true, name: true } } } },
      runner: { select: { id: true, name: true } },
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
 * agent; a user (OAuth or personal token) must own the assigned agent, or be
 * the runner of its active run: the user whose connection claimed it with the
 * run's one-time claim code (passing `claimCode` binds the run to them). From
 * then on the agent is the actor, on behalf of its owner.
 */
async function agentCtxFor(ctx: Ctx, issue: AgentIssue, claimCode?: string): Promise<Ctx> {
  const key = formatKey(issue.project.key, issue.number);
  const agent = issue.assigneeAgent;
  if (!agent) throw new ServiceError(409, `${key} isn't assigned to an agent`);
  if (!agent.enabled) throw new ServiceError(409, `${agent.name} is disabled`);
  if (ctx.actor.type === "agent") {
    if (ctx.actor.agentId !== agent.id) throw new ServiceError(409, `${key} is assigned to another agent`);
    return ctx;
  }
  if (ctx.actor.type !== "user") throw forbidden();
  const userId = ctx.actor.userId;
  const asAgent: Ctx = { ...ctx, actor: { type: "agent", agentId: agent.id, onBehalfOf: agent.ownerUserId } };
  if (agent.ownerUserId === userId) return asAgent;

  const active = { issueId: issue.id, agentId: agent.id, status: { in: ACTIVE_RUN } };
  if (await db.agentRun.count({ where: { ...active, runnerUserId: userId } })) return asAgent;
  if (claimCode?.trim()) {
    // One-time: the code is cleared as the run is bound, so a second use matches nothing.
    const { count } = await db.agentRun.updateMany({
      where: { ...active, claimCodeHash: hashClaimCode(claimCode) },
      data: { claimCodeHash: null, runnerUserId: userId },
    });
    if (count) return asAgent;
    throw new ServiceError(409, `That claim code isn't valid for ${key}'s current run. It works once, while the run is active.`);
  }
  const me = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
  throw new ServiceError(
    409,
    `${key} is assigned to ${agent.name}, which isn't yours (this connection is signed in to Kanso as ${me?.name ?? "someone else"}). Pass the claim code from the run's message to claim_issue.`,
  );
}

/** Issues assigned to the calling agent (or to the caller's agents) that aren't done. */
export async function listAgentQueue(ctx: Ctx) {
  authorize(ctx, "project.read");
  await failStaleRuns();
  const agentFilter: Prisma.IssueWhereInput =
    ctx.actor.type === "agent"
      ? { assigneeAgentId: ctx.actor.agentId }
      : {
          assigneeAgent: { enabled: true },
          OR: [
            { assigneeAgent: { ownerUserId: actingUserId(ctx) ?? "" } },
            // Runs this user's connection claimed with a claim code.
            { agentRuns: { some: { runnerUserId: actingUserId(ctx) ?? "", status: { in: ACTIVE_RUN } } } },
          ],
        };
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
export async function claimIssue(ctx: Ctx, key: string, claimCode?: string) {
  authorize(ctx, "issue.write");
  const issue = await findAgentIssue(ctx, key);
  const agentCtx = await agentCtxFor(ctx, issue, claimCode);
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
  const agentCtx = await agentCtxFor(ctx, issue);
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
  const agentCtx = await agentCtxFor(ctx, issue);
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

const pullRequestSchema = z.object({
  branch: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^(?!refs\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/, "That isn't a valid branch name"),
  title: z.string().trim().min(1).max(256),
  body: z.string().max(60_000).default(""),
});

/**
 * The workspace agent's pushed branch becomes a pull request
 * (docs/features/18-workspace-agent.md "open_pull_request"). Kanso opens it
 * as its GitHub App: only for the agent that claimed the
 * issue, only in the issue's repository, never from the base branch. Never
 * merges.
 */
export async function openPullRequest(ctx: Ctx, key: string, input: unknown) {
  authorize(ctx, "issue.write");
  const data = pullRequestSchema.parse(input);
  const issue = await findAgentIssue(ctx, key);
  const agentCtx = await agentCtxFor(ctx, issue);
  const agentId = issue.assigneeAgent!.id;
  const issueKey = formatKey(issue.project.key, issue.number);
  const agent = await db.agent.findUniqueOrThrow({ where: { id: agentId }, select: { kind: true } });
  if (agent.kind !== "CLAUDE_API") {
    throw badRequest("open_pull_request is for the workspace agent. Push your branch and open the pull request yourself.");
  }
  if (issue.claimedByAgentId !== agentId) throw new ServiceError(409, `Claim ${issueKey} first`);
  const repository = await issueRepository(issue.id);
  if (!repository) throw new ServiceError(409, "The project has no connected GitHub repository");

  const body = data.body.toUpperCase().includes(issueKey) ? data.body : `${data.body}\n\nKanso issue: ${issueKey}`.trim();
  let pr;
  try {
    const { token } = await repoAccessToken(ctx.workspaceId, repository.fullName, PULL_REQUEST_PERMISSIONS, "open pull requests in");
    const base = repository.baseBranch ?? (await getRepo(token, repository.fullName)).default_branch;
    if (data.branch === base) throw badRequest(`Push your work to its own branch, not ${base}`);
    pr = await createPullRequest(token, repository.fullName, { head: data.branch, base, title: data.title, body });
  } catch (error) {
    if (error instanceof DispatchError) throw new ServiceError(409, error.message);
    if (!(error instanceof GitHubError)) throw error;
    if (error.status === 404) throw new ServiceError(502, `Kanso's GitHub App can't see ${repository.fullName}`);
    // GitHub's own explanation, e.g. no commits between the branches, or a PR already exists.
    if (error.status === 422) throw badRequest(error.message.slice(0, 300));
    throw new ServiceError(502, "GitHub couldn't open the pull request; try again");
  }

  const where = { issueId_repoFullName_number: { issueId: issue.id, repoFullName: repository.fullName, number: pr.number } };
  const fields = { url: pr.html_url, title: pr.title.slice(0, 300), branch: pr.head.ref.slice(0, 255), headSha: pr.head.sha, state: "OPEN" as const };
  const link = await db.pullRequestLink.upsert({
    where,
    create: { issueId: issue.id, repoFullName: repository.fullName, number: pr.number, ...fields },
    update: fields,
    select: { url: true, state: true },
  });
  await onPullRequestLinked(agentCtx, issue.id, link);
  return { url: pr.html_url, number: pr.number };
}
