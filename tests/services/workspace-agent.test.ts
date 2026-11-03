import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { reconcileRun } from "@/lib/agents/claude-api";
import { setAnthropicClientFactory } from "@/lib/agents/claude-api-client";
import { db } from "@/lib/db";
import { flushDeferred } from "@/lib/defer";
import { setGitHubFetch } from "@/lib/github/client";
import {
  assignAgent,
  claimIssue,
  createAgent,
  deleteAgent,
  listAgentRuns,
  listAgents,
  openPullRequest,
  reportProgress,
  updateAgent,
} from "@/lib/services/agents";
import { ctxForApiToken } from "@/lib/services/api-tokens";
import { addComment } from "@/lib/services/comments";
import type { Ctx } from "@/lib/services/context";

import { addMember, makeTeam, makeUser } from "../factories";
import { expectStatus, makeIssue, makeProject } from "../helpers";

const API_KEY = "sk-ant-api03-test-key-0123456789abcdefWXYZ";
const GH_TOKEN = "github_pat_0123456789abcdefghijklmnop";

// ---------- a fake Anthropic ----------

type Sent = { sessionId: string; events: { type: string; [k: string]: unknown }[] };
type StopReason = { type: string; event_ids?: string[] };

let anthropic: {
  keys: string[];
  environments: unknown[];
  agents: Record<string, unknown>[];
  updates: { id: string; params: Record<string, unknown> }[];
  credentials: { vaultId: string; params: { auth: { token: string; mcp_server_url: string; type: string } } }[];
  sessions: Record<string, unknown>[];
  sent: Sent[];
  retrieves: number;
  status: string;
  costCents: number;
  idle: StopReason | null;
  failWith: Error | null;
};

function resetAnthropic() {
  anthropic = {
    keys: [],
    environments: [],
    agents: [],
    updates: [],
    credentials: [],
    sessions: [],
    sent: [],
    retrieves: 0,
    status: "running",
    costCents: 0,
    idle: null,
    failWith: null,
  };
}

const guard = () => {
  if (anthropic.failWith) throw anthropic.failWith;
};

function fakeClient(apiKey: string) {
  anthropic.keys.push(apiKey);
  return {
    beta: {
      environments: {
        create: async (params: unknown) => {
          guard();
          anthropic.environments.push(params);
          return { id: `env_${anthropic.environments.length}` };
        },
      },
      agents: {
        create: async (params: Record<string, unknown>) => {
          guard();
          anthropic.agents.push(params);
          return { id: `agent_${anthropic.agents.length}`, version: 1 };
        },
        update: async (id: string, params: Record<string, unknown>) => {
          guard();
          anthropic.updates.push({ id, params });
          return { id, version: (params.version as number) + 1 };
        },
      },
      vaults: {
        create: async () => {
          guard();
          return { id: `vlt_${anthropic.credentials.length + 1}` };
        },
        credentials: {
          create: async (vaultId: string, params: (typeof anthropic.credentials)[number]["params"]) => {
            anthropic.credentials.push({ vaultId, params });
            return { id: "vcrd_1" };
          },
        },
      },
      sessions: {
        create: async (params: Record<string, unknown>) => {
          guard();
          anthropic.sessions.push(params);
          return { id: `sesn_${anthropic.sessions.length}` };
        },
        retrieve: async () => {
          anthropic.retrieves++;
          return { status: anthropic.status, usage: { list_cost: { amount: String(anthropic.costCents), currency: "USD" } } };
        },
        events: {
          send: async (sessionId: string, params: { events: Sent["events"] }) => {
            guard();
            anthropic.sent.push({ sessionId, events: params.events });
            return {};
          },
          list: async () => ({
            data: anthropic.idle ? [{ type: "session.status_idle", id: "sevt_idle", stop_reason: anthropic.idle }] : [],
          }),
        },
      },
    },
  } as unknown as Anthropic;
}

// ---------- a fake GitHub ----------

let github: { canPush: boolean; tokenValid: boolean; pulls: { url: string; body: Record<string, string> }[] };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(() => {
  setAnthropicClientFactory(fakeClient);
  setGitHubFetch(async (input, init) => {
    const url = String(input);
    const auth = new Headers(init?.headers).get("authorization");
    if (!github.tokenValid || auth !== `Bearer ${GH_TOKEN}`) return json(401, { message: "Bad credentials" });
    if (url.endsWith("/user")) return json(200, { id: 1, login: "kanso-bot" });
    if (url.endsWith("/repos/acme/web/pulls") && init?.method === "POST") {
      const body = JSON.parse(String(init.body)) as Record<string, string>;
      github.pulls.push({ url, body });
      return json(201, { number: 7, html_url: "https://github.com/acme/web/pull/7", title: body.title, state: "open", head: { ref: body.head, sha: "abc123" } });
    }
    if (url.endsWith("/repos/acme/web")) return json(200, { default_branch: "main", permissions: { push: github.canPush } });
    return json(404, { message: "Not Found" });
  });
});
afterAll(() => {
  setAnthropicClientFactory(null);
  setGitHubFetch(null);
});
beforeEach(() => {
  resetAnthropic();
  github = { canPush: true, tokenValid: true, pulls: [] };
});

// ---------- setup ----------

const connect = (ctx: Ctx, extra: Record<string, unknown> = {}) =>
  createAgent(ctx, { kind: "CLAUDE_API", name: "Workspace agent", apiKey: API_KEY, githubToken: GH_TOKEN, ...extra });

async function setup(extra: Record<string, unknown> = {}) {
  const team = await makeTeam();
  const web = await makeProject(team.ctx, "Web", "WEB");
  const installation = await db.gitHubInstallation.create({
    data: { workspaceId: team.workspace.id, installationId: 91, accountLogin: "acme", accountType: "Organization" },
  });
  await db.projectRepo.create({ data: { projectId: web.project.id, installationId: installation.id, repoFullName: "acme/web" } });
  const { agent } = await connect(team.ctx, extra);
  const member = await addMember(team.workspace.id, await makeUser("Mo"), "MEMBER");
  // The agent's own MCP connection: the Kanso token Kanso put in the vault.
  const agentCtx = (await ctxForApiToken(anthropic.credentials[0]!.params.auth.token))!;
  return { ...team, web, agent, member, agentCtx };
}

async function dispatched(s: Awaited<ReturnType<typeof setup>>, title = "Fix login redirect") {
  const issue = await makeIssue(s.member, s.web.todo.id, title);
  const { runId } = await assignAgent(s.member, issue.id, { agentId: s.agent.id });
  await flushDeferred();
  return { issue, runId: runId! };
}

const runOf = (id: string) => db.agentRun.findUniqueOrThrow({ where: { id } });
const sync = async (runId: string) => {
  await reconcileRun(runId, { force: true });
  await flushDeferred();
};
const interrupts = () => anthropic.sent.filter((s) => s.events.some((e) => e.type === "user.interrupt"));

// ---------- tests ----------

describe("connecting the workspace agent", () => {
  it("provisions the environment, agent and vault; secrets never come back", async () => {
    const { ctx, member, agent } = await setup();
    expect(anthropic.keys.every((k) => k === API_KEY)).toBe(true);
    expect(anthropic.environments).toHaveLength(1);
    const definition = anthropic.agents[0]!;
    expect(definition.model).toBe("claude-opus-5-5");
    expect(JSON.stringify(definition.mcp_servers)).toContain("/api/mcp");
    expect(JSON.stringify(definition.tools)).toContain('"web_search","enabled":false');
    const credential = anthropic.credentials[0]!.params.auth;
    expect(credential.type).toBe("static_bearer");
    expect(credential.token).toMatch(/^kanso_/);
    expect(credential.mcp_server_url).toMatch(/\/api\/mcp$/);

    expect(agent.enabled).toBe(true);
    const listed = (await listAgents(ctx)).find((a) => a.id === agent.id)!;
    expect(listed.workspaceAgent).toMatchObject({ apiKeyHint: "…WXYZ", githubTokenHint: "…mnop", monthlyLimitCents: 10_000, runLimitCents: 2_500 });
    const text = JSON.stringify(await listAgents(ctx));
    expect(text).not.toContain(API_KEY);
    expect(text).not.toContain(GH_TOKEN);

    // Members see it (to assign it) but not its settings or spend.
    const seen = (await listAgents(member)).find((a) => a.id === agent.id)!;
    expect(seen.workspaceAgent).toBeUndefined();
    expect("spend" in seen).toBe(false);
  });

  it("admins only, one per workspace, bad keys and tokens refused", async () => {
    const { ctx, member } = await setup();
    await expectStatus(connect(member, { name: "Mine" }), 403);
    await expectStatus(connect(ctx, { name: "Another" }), 409);

    const other = await makeTeam("Globex");
    await expect(connect(other.ctx, { apiKey: "not-a-key" })).rejects.toMatchObject({ name: "ZodError" });
    anthropic.failWith = new Anthropic.AuthenticationError(401, {}, "invalid x-api-key", new Headers());
    const refused = await connect(other.ctx).catch((e: Error) => e);
    expect(refused).toMatchObject({ status: 400, message: "Claude rejected that API key" });
    // Nothing half set up is left behind.
    expect(await db.agent.count({ where: { workspaceId: other.workspace.id } })).toBe(0);

    anthropic.failWith = null;
    github.tokenValid = false;
    await expect(connect(other.ctx)).rejects.toMatchObject({ status: 400, message: "GitHub rejected that token" });
  });

  it("a new model publishes a new version; a new key provisions afresh and revokes the old token", async () => {
    const { ctx, agent } = await setup();
    await updateAgent(ctx, agent.id, { model: "claude-sonnet-5-5" });
    expect(anthropic.updates[0]).toMatchObject({ id: "agent_1", params: { model: "claude-sonnet-5-5", version: 1 } });

    const oldToken = anthropic.credentials[0]!.params.auth.token;
    const newKey = "sk-ant-api03-another-key-9876543210ABCD";
    await updateAgent(ctx, agent.id, { apiKey: newKey });
    expect(anthropic.keys.at(-1)).toBe(newKey);
    expect(anthropic.credentials).toHaveLength(2);
    expect(await ctxForApiToken(oldToken)).toBeNull();
    const listed = (await listAgents(ctx)).find((a) => a.id === agent.id)!;
    expect(listed.workspaceAgent?.apiKeyHint).toBe("…ABCD");
  });
});

describe("runs", () => {
  it("any member hands it work: a session with the repo, vault, budget and first message", async () => {
    const s = await setup();
    const { issue, runId } = await dispatched(s);
    const params = anthropic.sessions[0]!;
    expect(params).toMatchObject({
      agent: { type: "agent", id: "agent_1", version: 1 },
      environment_id: "env_1",
      vault_ids: ["vlt_1"],
      budget: { type: "limit", max_list_cost: { amount: "2500", currency: "USD" } },
      resources: [{ type: "github_repository", url: "https://github.com/acme/web", authorization_token: GH_TOKEN }],
    });
    expect(JSON.stringify(params.initial_events)).toContain("WEB-1");
    expect(JSON.stringify(params.initial_events)).toContain(s.workspace.slug);

    const run = await runOf(runId);
    expect(run).toMatchObject({ status: "DISPATCHED", externalSessionId: "sesn_1", budgetCents: 2500 });
    expect(run.sessionUrl).toBe("https://platform.claude.com/workspaces/default/sessions/sesn_1");
    // The person stays the assignee.
    const after = await db.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(after.assigneeUserId).toBe(s.member.actor.type === "user" ? s.member.actor.userId : null);
  });

  it("enforces the monthly limit, counting what active runs have reserved", async () => {
    const s = await setup({ monthlyLimit: 30, runLimit: 25 });
    await dispatched(s, "One");
    const second = await dispatched(s, "Two");
    expect((await runOf(second.runId)).budgetCents).toBe(500);
    const third = await dispatched(s, "Three");
    expect(await runOf(third.runId)).toMatchObject({ status: "FAILED" });
    expect((await runOf(third.runId)).error).toContain("$30 monthly limit");
    expect(anthropic.sessions).toHaveLength(2);
  });

  it("fails the run when the GitHub token can't push", async () => {
    const s = await setup();
    github.canPush = false;
    const { runId } = await dispatched(s);
    expect(await runOf(runId)).toMatchObject({ status: "FAILED", error: "The workspace agent's GitHub token can't push to acme/web" });
    expect(anthropic.sessions).toHaveLength(0);
  });
});

describe("keeping runs in sync", () => {
  it("records cost, waits for input after a turn, and a teammate's comment resumes it", async () => {
    const s = await setup();
    const guest = await addMember(s.workspace.id, await makeUser("Gil"), "GUEST");
    const { issue, runId } = await dispatched(s);
    await claimIssue(s.agentCtx, "WEB-1");
    expect((await runOf(runId)).status).toBe("RUNNING");

    anthropic.status = "idle";
    anthropic.costCents = 184;
    anthropic.idle = { type: "end_turn" };
    await sync(runId);
    expect(await runOf(runId)).toMatchObject({ status: "NEEDS_INPUT", costCents: 184 });

    // The agent's own update and a guest's comment aren't sent to it.
    await reportProgress(s.agentCtx, "WEB-1", { message: "Which provider?" });
    await addComment(guest, issue.id, { body: "drive-by" }).catch(() => null);
    await flushDeferred();
    expect(anthropic.sent).toHaveLength(0);

    await addComment(s.member, issue.id, { body: "Use GitHub OAuth." });
    await flushDeferred();
    const message = anthropic.sent[0]!;
    expect(message.sessionId).toBe("sesn_1");
    expect(JSON.stringify(message.events)).toContain("Comment from Mo on WEB-1 in Kanso:");
    expect(JSON.stringify(message.events)).toContain("Use GitHub OAuth.");
    expect((await runOf(runId)).status).toBe("RUNNING");
  });

  it("is throttled when read", async () => {
    const s = await setup();
    const { issue } = await dispatched(s);
    await listAgentRuns(s.member, issue.id);
    await listAgentRuns(s.member, issue.id);
    // Dispatch just synced it.
    expect(anthropic.retrieves).toBe(0);
    await db.agentRun.updateMany({ data: { syncedAt: null } });
    await listAgentRuns(s.member, issue.id);
    await listAgentRuns(s.member, issue.id);
    expect(anthropic.retrieves).toBe(1);
  });

  it("denies tool approvals; fails on budget, refusal, or a session that stops before claiming", async () => {
    const s = await setup();
    const { runId } = await dispatched(s);
    anthropic.status = "idle";
    anthropic.idle = { type: "requires_action", event_ids: ["sevt_tool"] };
    await sync(runId);
    expect(anthropic.sent[0]!.events[0]).toMatchObject({ type: "user.tool_confirmation", tool_use_id: "sevt_tool", result: "deny" });
    expect((await runOf(runId)).status).toBe("DISPATCHED");

    anthropic.idle = { type: "end_turn" };
    await sync(runId);
    expect(await runOf(runId)).toMatchObject({ status: "FAILED", error: "Stopped without claiming the issue" });

    const second = await dispatched(s, "Two");
    await claimIssue(s.agentCtx, "WEB-2");
    anthropic.idle = { type: "budget_reached" };
    await sync(second.runId);
    expect(await runOf(second.runId)).toMatchObject({ status: "FAILED", error: "Reached its $25 run limit" });
    expect(interrupts().map((i) => i.sessionId)).toContain("sesn_2");
  });

  it("cancelling or disabling interrupts the session", async () => {
    const s = await setup();
    const { issue } = await dispatched(s);
    await assignAgent(s.member, issue.id, { agentId: null });
    await flushDeferred();
    expect(interrupts().map((i) => i.sessionId)).toEqual(["sesn_1"]);

    const { runId } = await dispatched(s, "Two");
    await expectStatus(updateAgent(s.member, s.agent.id, { enabled: false }), 403);
    await updateAgent(s.ctx, s.agent.id, { enabled: false });
    await flushDeferred();
    expect(await runOf(runId)).toMatchObject({ status: "CANCELLED" });
    expect(interrupts().map((i) => i.sessionId)).toEqual(["sesn_1", "sesn_2"]);

    await deleteAgent(s.ctx, s.agent.id);
  });
});

describe("open_pull_request", () => {
  it("opens the PR with the GitHub token, links it, and moves the run to PR_OPEN", async () => {
    const s = await setup();
    const { issue, runId } = await dispatched(s);
    const pr = { branch: "web-1-fix-login-redirect", title: "Fix login redirect", body: "Done." };
    await expectStatus(openPullRequest(s.agentCtx, "WEB-1", pr), 409);
    await claimIssue(s.agentCtx, "WEB-1");
    await expectStatus(openPullRequest(s.agentCtx, "WEB-1", { ...pr, branch: "main" }), 400);
    await expect(openPullRequest(s.agentCtx, "WEB-1", { ...pr, branch: "../evil" })).rejects.toMatchObject({ name: "ZodError" });

    const opened = await openPullRequest(s.agentCtx, "WEB-1", pr);
    expect(opened).toEqual({ url: "https://github.com/acme/web/pull/7", number: 7 });
    expect(github.pulls[0]!.body).toMatchObject({ head: pr.branch, base: "main", title: pr.title });
    expect(github.pulls[0]!.body.body).toContain("WEB-1");
    expect(await runOf(runId)).toMatchObject({ status: "PR_OPEN", prUrl: opened.url });
    expect(await db.pullRequestLink.count({ where: { issueId: issue.id } })).toBe(1);

    // A session that ends with the PR open waits for review.
    anthropic.status = "terminated";
    await sync(runId);
    expect((await runOf(runId)).status).toBe("PR_OPEN");
  });

  it("is only for the workspace agent", async () => {
    const s = await setup();
    const { agent, secrets } = await createAgent(s.ctx, { kind: "MCP", name: "Bot", webhookUrl: null });
    const botCtx = (await ctxForApiToken(secrets.token!))!;
    const issue = await makeIssue(s.ctx, s.web.todo.id, "Other");
    await assignAgent(s.ctx, issue.id, { agentId: agent.id });
    await flushDeferred();
    await claimIssue(botCtx, "WEB-1");
    await expectStatus(openPullRequest(botCtx, "WEB-1", { branch: "web-1-other", title: "Other" }), 400);
  });
});
