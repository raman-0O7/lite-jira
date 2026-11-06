import Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { reconcileRun, renewGitHubAccess } from "@/lib/agents/claude-api";
import { setAnthropicClientFactory } from "@/lib/agents/claude-api-client";
import { db } from "@/lib/db";
import { flushDeferred } from "@/lib/defer";
import { setGitHubFetch } from "@/lib/github/client";
import {
  assignAgent,
  claimIssue,
  createAgent,
  deleteAgent,
  getWorkspaceAgentGitHub,
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
import { configureGitHubEnv } from "../fake-github";
import { expectStatus, makeIssue, makeProject } from "../helpers";

const API_KEY = "sk-ant-api03-test-key-0123456789abcdefWXYZ";

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
  tokenUpdates: { resourceId: string; session_id: string; authorization_token: string }[];
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
    tokenUpdates: [],
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
          const n = anthropic.sessions.length;
          return { id: `sesn_${n}`, resources: [{ id: `sesrsc_${n}`, type: "github_repository" }] };
        },
        resources: {
          update: async (resourceId: string, params: { session_id: string; authorization_token: string }) => {
            guard();
            anthropic.tokenUpdates.push({ resourceId, ...params });
            return { id: resourceId, type: "github_repository" };
          },
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

// ---------- a fake GitHub (Kanso's GitHub App) ----------

type Permissions = Record<string, string>;
let github: {
  /** What the app asks installations for, and what installation 91 (acme) has accepted. */
  app: Permissions;
  installation: Permissions;
  tokens: { token: string; repositories: string[]; permissions: Permissions }[];
  pulls: { auth: string | null; body: Record<string, string> }[];
};

const CODE_ACCESS = { issues: "write", contents: "write", pull_requests: "write", checks: "read", metadata: "read" };
const OLD_ACCESS = { issues: "write", pull_requests: "read", checks: "read", metadata: "read" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const tokenAllows = (auth: string | null, permission: string) =>
  github.tokens.some((t) => auth === `Bearer ${t.token}` && t.permissions[permission] === "write");

beforeAll(() => {
  configureGitHubEnv();
  setAnthropicClientFactory(fakeClient);
  setGitHubFetch(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    const auth = new Headers(init?.headers).get("authorization");
    if (path === "/app") return json(200, { slug: "kanso-test", owner: { login: "kanso-dev", type: "User" }, permissions: github.app });
    if (path === "/app/installations/91") {
      return json(200, { id: 91, account: { login: "acme", type: "Organization" }, permissions: github.installation });
    }
    if (path === "/app/installations/91/access_tokens" && method === "POST") {
      const body = JSON.parse(String(init!.body)) as { repositories: string[]; permissions: Permissions };
      const granted = Object.entries(body.permissions).every(
        ([name, level]) => github.installation[name] === "write" || (level === "read" && github.installation[name]),
      );
      if (!granted) return json(422, { message: "The permissions requested are not granted to this installation." });
      if (!body.repositories.every((r) => r === "web")) {
        return json(422, { message: "There is at least one repository that does not exist or is not accessible to the parent installation." });
      }
      const token = `ghs_${github.tokens.length + 1}`;
      github.tokens.push({ token, ...body });
      return json(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    }
    if (path === "/repos/acme/web/pulls" && method === "POST") {
      if (!tokenAllows(auth, "pull_requests")) return json(403, { message: "Resource not accessible by integration" });
      const body = JSON.parse(String(init!.body)) as Record<string, string>;
      github.pulls.push({ auth, body });
      return json(201, { number: 7, html_url: "https://github.com/acme/web/pull/7", title: body.title, state: "open", head: { ref: body.head, sha: "abc123" } });
    }
    if (path === "/repos/acme/web") return json(200, { default_branch: "main" });
    return json(404, { message: "Not Found" });
  });
});
afterAll(() => {
  setAnthropicClientFactory(null);
  setGitHubFetch(null);
});
beforeEach(() => {
  resetAnthropic();
  github = { app: { ...CODE_ACCESS }, installation: { ...CODE_ACCESS }, tokens: [], pulls: [] };
});

// ---------- setup ----------

const connect = (ctx: Ctx, extra: Record<string, unknown> = {}) =>
  createAgent(ctx, { kind: "CLAUDE_API", name: "Workspace agent", apiKey: API_KEY, ...extra });

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
    expect(listed.workspaceAgent).toEqual({
      apiKeyHint: "…WXYZ",
      model: "claude-opus-5-5",
      monthlyLimitCents: 10_000,
      runLimitCents: 2_500,
      consoleWorkspaceId: null,
    });
    expect(JSON.stringify(await listAgents(ctx))).not.toContain(API_KEY);

    // Members see it (to assign it) but not its settings or spend.
    const seen = (await listAgents(member)).find((a) => a.id === agent.id)!;
    expect(seen.workspaceAgent).toBeUndefined();
    expect("spend" in seen).toBe(false);
  });

  it("admins only, one per workspace, bad keys refused", async () => {
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
  });

  it("shows admins whether Kanso's GitHub App can push, and who can fix it", async () => {
    const { ctx, member, workspace } = await setup();
    await expectStatus(getWorkspaceAgentGitHub(member), 403);
    expect(await getWorkspaceAgentGitHub(ctx)).toEqual({
      status: "ready",
      accounts: [{ login: "acme", ready: true, settingsUrl: "https://github.com/organizations/acme/settings/installations/91" }],
    });

    // The app asks for code access, but acme's owner hasn't accepted it yet.
    github.installation = { ...OLD_ACCESS };
    expect(await getWorkspaceAgentGitHub(ctx)).toMatchObject({ status: "needs_approval", accounts: [{ login: "acme", ready: false }] });

    // The app itself doesn't ask for it: only whoever runs Kanso gets the settings link.
    github.app = { ...OLD_ACCESS };
    process.env.OWNER_EMAILS = "someone-else@example.test";
    expect(await getWorkspaceAgentGitHub(ctx)).toEqual({ status: "app_needs_access", settingsUrl: null });
    const owner = await db.user.findUniqueOrThrow({ where: { id: ctx.actor.type === "user" ? ctx.actor.userId : "" } });
    process.env.OWNER_EMAILS = owner.email;
    expect(await getWorkspaceAgentGitHub(ctx)).toEqual({
      status: "app_needs_access",
      settingsUrl: "https://github.com/settings/apps/kanso-test/permissions",
    });
    delete process.env.OWNER_EMAILS;

    await db.gitHubInstallation.deleteMany({ where: { workspaceId: workspace.id } });
    expect(await getWorkspaceAgentGitHub(ctx)).toEqual({ status: "not_connected" });
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
      resources: [{ type: "github_repository", url: "https://github.com/acme/web", authorization_token: "ghs_1" }],
    });
    // A GitHub App token for this one repository that can only push.
    expect(github.tokens[0]).toEqual({ token: "ghs_1", repositories: ["web"], permissions: { contents: "write", metadata: "read" } });
    expect(JSON.stringify(params.initial_events)).toContain("WEB-1");
    expect(JSON.stringify(params.initial_events)).toContain(s.workspace.slug);

    const run = await runOf(runId);
    expect(run).toMatchObject({ status: "DISPATCHED", externalSessionId: "sesn_1", budgetCents: 2500, githubResourceId: "sesrsc_1" });
    expect(run.githubTokenAt).not.toBeNull();
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

  it("fails the run, saying who can fix it, when Kanso's GitHub App can't push", async () => {
    const s = await setup();
    github.installation = { ...OLD_ACCESS };
    const { runId } = await dispatched(s);
    expect(await runOf(runId)).toMatchObject({
      status: "FAILED",
      error: "Kanso's GitHub App can't push to acme/web yet. An owner of acme needs to accept the app's updated permissions on GitHub.",
    });

    github.app = { ...OLD_ACCESS };
    const second = await dispatched(s, "Two");
    expect((await runOf(second.runId)).error).toBe(
      "Kanso's GitHub App doesn't have access to code yet. Whoever runs Kanso needs to give it Contents and Pull requests (read and write) access on GitHub.",
    );
    expect(anthropic.sessions).toHaveLength(0);
  });

  it("renews the session's GitHub token once it's half an hour old", async () => {
    const s = await setup();
    const { runId } = await dispatched(s);
    // Fresh: nothing to do.
    await renewGitHubAccess({ agentId: s.agent.id });
    expect(anthropic.tokenUpdates).toHaveLength(0);

    await db.agentRun.update({ where: { id: runId }, data: { githubTokenAt: new Date(Date.now() - 31 * 60_000) } });
    await renewGitHubAccess({ agentId: s.agent.id });
    await renewGitHubAccess({ agentId: s.agent.id });
    expect(anthropic.tokenUpdates).toEqual([{ resourceId: "sesrsc_1", session_id: "sesn_1", authorization_token: "ghs_2" }]);
    expect(github.tokens[1]).toMatchObject({ repositories: ["web"], permissions: { contents: "write", metadata: "read" } });

    // A reconcile renews too; a failure is retried a minute later, not on every call.
    await db.agentRun.update({ where: { id: runId }, data: { githubTokenAt: new Date(Date.now() - 31 * 60_000) } });
    github.installation = { ...OLD_ACCESS };
    await sync(runId);
    await renewGitHubAccess({ agentId: s.agent.id });
    expect(anthropic.tokenUpdates).toHaveLength(1);
    const retryAt = (await runOf(runId)).githubTokenAt!.getTime();
    expect(Date.now() - retryAt).toBeGreaterThan(28 * 60_000);
    expect(Date.now() - retryAt).toBeLessThan(30 * 60_000);
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
  it("opens the PR as Kanso's GitHub App, links it, and moves the run to PR_OPEN", async () => {
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
    // With its own token, which can open pull requests and nothing else.
    const used = github.tokens.find((t) => github.pulls[0]!.auth === `Bearer ${t.token}`)!;
    expect(used).toMatchObject({ repositories: ["web"], permissions: { pull_requests: "write", metadata: "read" } });
    expect(github.pulls[0]!.body.body).toContain("WEB-1");
    expect(await runOf(runId)).toMatchObject({ status: "PR_OPEN", prUrl: opened.url });
    expect(await db.pullRequestLink.count({ where: { issueId: issue.id } })).toBe(1);

    // A session that ends with the PR open waits for review.
    anthropic.status = "terminated";
    await sync(runId);
    expect((await runOf(runId)).status).toBe("PR_OPEN");
  });

  it("says who can fix it when the app can't open pull requests", async () => {
    const s = await setup();
    await dispatched(s);
    await claimIssue(s.agentCtx, "WEB-1");
    github.installation = { ...OLD_ACCESS };
    await expect(openPullRequest(s.agentCtx, "WEB-1", { branch: "web-1-fix", title: "Fix" })).rejects.toMatchObject({
      status: 409,
      message: "Kanso's GitHub App can't open pull requests in acme/web yet. An owner of acme needs to accept the app's updated permissions on GitHub.",
    });
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
