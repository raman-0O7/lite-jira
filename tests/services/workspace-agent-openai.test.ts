import OpenAI from "openai";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { setAnthropicClientFactory } from "@/lib/agents/claude-api-client";
import { CHECKOUT_PATH, GIT_SECRET_NAME, reconcileOpenAiRun, renewOpenAiGitHubAccess, SANDBOX_HOSTS } from "@/lib/agents/openai-api";
import { setOpenAiClientFactory } from "@/lib/agents/openai-api-client";
import { db } from "@/lib/db";
import { flushDeferred } from "@/lib/defer";
import { setGitHubFetch } from "@/lib/github/client";
import { assignAgent, claimIssue, createAgent, listAgents, openPullRequest, reportProgress, updateAgent } from "@/lib/services/agents";
import { ctxForApiToken } from "@/lib/services/api-tokens";
import { addComment } from "@/lib/services/comments";
import type { Ctx } from "@/lib/services/context";

import { addMember, makeTeam, makeUser } from "../factories";
import { configureGitHubEnv } from "../fake-github";
import { expectStatus, makeIssue, makeProject } from "../helpers";

/** docs/features/25-workspace-agent-openai.md */

const API_KEY = "sk-proj-openai-agents-test-0123456789OPEN";

// ---------- a fake OpenAI ----------

type Credential = { id: string; vaultId: string; params: { name: string; auth: Record<string, unknown> } };
type Event = { type: string; [k: string]: unknown };

let openai: {
  keys: string[];
  listed: number;
  agents: Record<string, unknown>[];
  agentUpdates: { id: string; params: Record<string, unknown> }[];
  vaults: { id: string; params: Record<string, unknown> }[];
  deletedVaults: string[];
  credentials: Credential[];
  credentialUpdates: { id: string; params: Record<string, unknown> }[];
  sessions: Record<string, unknown>[];
  sent: { sessionId: string; events: Event[]; idempotencyKey?: string }[];
  status: string;
  spend: { limit: number | null; consumed: number | null };
  requiredActions: Record<string, unknown>[];
  error: string | null;
  failWith: Error | null;
};

function resetOpenAi() {
  openai = {
    keys: [],
    listed: 0,
    agents: [],
    agentUpdates: [],
    vaults: [],
    deletedVaults: [],
    credentials: [],
    credentialUpdates: [],
    sessions: [],
    sent: [],
    status: "in_progress",
    spend: { limit: 2500, consumed: 0 },
    requiredActions: [],
    error: null,
    failWith: null,
  };
}

const guard = () => {
  if (openai.failWith) throw openai.failWith;
};

function fakeClient(apiKey: string) {
  openai.keys.push(apiKey);
  return {
    beta: {
      agents: {
        list: async () => {
          guard();
          openai.listed++;
          return { data: [] };
        },
        create: async (params: Record<string, unknown>) => {
          guard();
          openai.agents.push(params);
          return { id: `agent_${openai.agents.length}` };
        },
        update: async (id: string, params: Record<string, unknown>) => {
          guard();
          openai.agentUpdates.push({ id, params });
          return { id };
        },
        vaults: {
          create: async (params: Record<string, unknown>) => {
            guard();
            const id = `vault_${openai.vaults.length + 1}`;
            openai.vaults.push({ id, params });
            return { id };
          },
          delete: async (id: string) => {
            openai.deletedVaults.push(id);
            return { id, deleted: true };
          },
          credentials: {
            create: async (vaultId: string, params: Credential["params"]) => {
              guard();
              const id = `cred_${openai.credentials.length + 1}`;
              openai.credentials.push({ id, vaultId, params });
              return { id };
            },
            update: async (id: string, params: Record<string, unknown>) => {
              guard();
              openai.credentialUpdates.push({ id, params });
              return { id };
            },
          },
        },
        sessions: {
          create: async (params: Record<string, unknown>) => {
            guard();
            openai.sessions.push(params);
            return { id: `sess_${openai.sessions.length}` };
          },
          retrieve: async (id: string) => ({
            id,
            status: openai.status,
            error: openai.error,
            required_actions: openai.requiredActions,
            spend_control: openai.spend,
          }),
          events: {
            create: async (sessionId: string, params: { events: Event[]; "Idempotency-Key"?: string }) => {
              guard();
              openai.sent.push({ sessionId, events: params.events, idempotencyKey: params["Idempotency-Key"] });
            },
          },
        },
      },
    },
  } as unknown as OpenAI;
}

// ---------- a fake GitHub (Kanso's GitHub App) ----------

type Permissions = Record<string, string>;
let github: { tokens: { token: string; permissions: Permissions }[]; pulls: Record<string, string>[] };
const ACCESS = { issues: "write", contents: "write", pull_requests: "write", checks: "read", metadata: "read" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeAll(() => {
  configureGitHubEnv();
  setOpenAiClientFactory(fakeClient);
  // The Claude side must never be called for an OpenAI agent.
  setAnthropicClientFactory(() => {
    throw new Error("Anthropic called for an OpenAI workspace agent");
  });
  setGitHubFetch(async (input, init) => {
    const path = new URL(String(input)).pathname;
    const method = init?.method ?? "GET";
    if (path === "/app") return json(200, { slug: "kanso-test", owner: { login: "kanso-dev", type: "User" }, permissions: ACCESS });
    if (path === "/app/installations/91") return json(200, { id: 91, account: { login: "acme", type: "Organization" }, permissions: ACCESS });
    if (path === "/app/installations/91/access_tokens" && method === "POST") {
      const body = JSON.parse(String(init!.body)) as { permissions: Permissions };
      const token = `ghs_${github.tokens.length + 1}`;
      github.tokens.push({ token, permissions: body.permissions });
      return json(201, { token, expires_at: new Date(Date.now() + 3_600_000).toISOString() });
    }
    if (path === "/repos/acme/web/pulls" && method === "POST") {
      const body = JSON.parse(String(init!.body)) as Record<string, string>;
      github.pulls.push(body);
      return json(201, { number: 7, html_url: "https://github.com/acme/web/pull/7", title: body.title, state: "open", head: { ref: body.head, sha: "abc123" } });
    }
    if (path === "/repos/acme/web") return json(200, { default_branch: "main" });
    return json(404, { message: "Not Found" });
  });
});
afterAll(() => {
  setOpenAiClientFactory(null);
  setAnthropicClientFactory(null);
  setGitHubFetch(null);
});
beforeEach(() => {
  resetOpenAi();
  github = { tokens: [], pulls: [] };
});

// ---------- setup ----------

const connect = (ctx: Ctx, extra: Record<string, unknown> = {}) =>
  createAgent(ctx, { kind: "OPENAI_API", name: "Workspace agent", apiKey: API_KEY, ...extra });

async function setup(extra: Record<string, unknown> = {}) {
  const team = await makeTeam();
  const web = await makeProject(team.ctx, "Web", "WEB");
  const installation = await db.gitHubInstallation.create({
    data: { workspaceId: team.workspace.id, installationId: 91, accountLogin: "acme", accountType: "Organization" },
  });
  await db.projectRepo.create({ data: { projectId: web.project.id, installationId: installation.id, repoFullName: "acme/web", baseBranch: "develop" } });
  const { agent } = await connect(team.ctx, extra);
  const member = await addMember(team.workspace.id, await makeUser("Mo"), "MEMBER");
  const mcpCredential = openai.credentials[0]!.params.auth as { token: string };
  const agentCtx = (await ctxForApiToken(mcpCredential.token))!;
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
  await reconcileOpenAiRun(runId, { force: true });
  await flushDeferred();
};
const decode = (base64: string) => Buffer.from(base64, "base64").toString();

// ---------- tests ----------

describe("connecting the workspace agent on OpenAI", () => {
  it("checks the key, creates the saved agent and the vault; secrets never come back", async () => {
    const { ctx, agent } = await setup();
    expect(openai.keys.every((k) => k === API_KEY)).toBe(true);
    expect(openai.listed).toBe(1);
    const definition = openai.agents[0]!;
    expect(definition).toMatchObject({ model: "gpt-6-astra", name: "Workspace agent" });
    expect(definition.tools).toEqual([
      expect.objectContaining({ type: "mcp", server_label: "kanso", connection_origin: "service", required: true }),
    ]);
    expect(JSON.stringify(definition.tools)).toContain("/api/mcp");
    expect(openai.credentials[0]).toMatchObject({ vaultId: "vault_1", params: { auth: { type: "static_bearer" } } });
    expect((openai.credentials[0]!.params.auth as { token: string }).token).toMatch(/^kanso_/);

    const listed = (await listAgents(ctx)).find((a) => a.id === agent.id)!;
    expect(listed.kind).toBe("OPENAI_API");
    expect(listed.workspaceAgent).toEqual({
      provider: "openai",
      apiKeyHint: "…OPEN",
      model: "gpt-6-astra",
      monthlyLimitCents: 10_000,
      runLimitCents: 2_500,
      consoleWorkspaceId: null,
    });
    expect(JSON.stringify(listed)).not.toContain(API_KEY);
  });

  it("refuses a bad key, a second workspace agent of either provider, and members", async () => {
    const team = await makeTeam();
    openai.failWith = new OpenAI.AuthenticationError(401, {}, "Incorrect API key", new Headers());
    await expect(connect(team.ctx)).rejects.toMatchObject({ status: 400, message: "OpenAI rejected that API key" });
    expect(await db.agent.count()).toBe(0);
    openai.failWith = null;

    await connect(team.ctx);
    await expectStatus(connect(team.ctx, { name: "Another" }), 409);
    await expectStatus(
      createAgent(team.ctx, { kind: "CLAUDE_API", name: "Claude one", apiKey: "sk-ant-api03-test-key-0123456789abcdefWXYZ" }),
      409,
    );
    const member = await addMember(team.workspace.id, await makeUser("Mo"), "MEMBER");
    await expectStatus(createAgent(member, { kind: "OPENAI_API", name: "Mine", apiKey: API_KEY }), 403);
    await expect(createAgent(team.ctx, { kind: "OPENAI_API", name: "X", apiKey: "sk-ant-not-openai" })).rejects.toMatchObject({ name: "ZodError" });
  });

  it("updates the saved agent when the model changes", async () => {
    const { ctx, agent } = await setup();
    await updateAgent(ctx, agent.id, { model: "gpt-6.1-sol" });
    expect(openai.agentUpdates).toEqual([{ id: "agent_1", params: expect.objectContaining({ model: "gpt-6.1-sol" }) }]);
    await expect(updateAgent(ctx, agent.id, { model: "claude-opus-5-5" })).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("a run", () => {
  it("starts a hosted session with the repository reachable only through the run vault", async () => {
    const s = await setup();
    const { runId } = await dispatched(s);
    const session = openai.sessions[0]! as {
      agent_id: string;
      environment: { type: string; network: { access: string; allowed_domains: string[] }; files: { path: string; data: string }[] };
      vault_ids: string[];
      review: string;
      spend_control: { limit: number };
      input: string;
    };
    expect(session).toMatchObject({ agent_id: "agent_1", review: "auto_review", spend_control: { limit: 2500 } });
    expect(session.environment).toMatchObject({ type: "openai_hosted", network: { access: "restricted", allowed_domains: SANDBOX_HOSTS } });
    expect(session.vault_ids).toEqual(["vault_1", "vault_2"]);
    expect(session.input).toContain(`bash ${CHECKOUT_PATH}`);
    expect(session.input).toContain('claim_issue with workspace');

    // The run vault: the push token, Basic-encoded for git, for github.com only.
    const runCredential = openai.credentials.find((c) => c.vaultId === "vault_2")!;
    const auth = runCredential.params.auth as { type: string; secret_name: string; secret_value: string; networking: unknown };
    expect(auth).toMatchObject({ type: "environment_variable", secret_name: GIT_SECRET_NAME, networking: { type: "limited", allowed_hosts: ["github.com"] } });
    const pushToken = github.tokens.at(-1)!;
    // Push only (GitHub adds metadata read to every token).
    expect(pushToken.permissions).toEqual({ contents: "write", metadata: "read" });
    expect(decode(auth.secret_value)).toBe(`x-access-token:${pushToken.token}`);

    // The checkout script holds no secret; it reads the placeholder at run time.
    const script = decode(session.environment.files.find((f) => f.path === CHECKOUT_PATH)!.data);
    expect(script).not.toContain(pushToken.token);
    expect(script).toContain(`Authorization: Basic \${${GIT_SECRET_NAME}}`);
    expect(script).toContain("http.https://github.com/.extraheader");
    expect(script).toContain("git clone --branch 'develop' https://github.com/acme/web.git /workspace/repo");

    expect(await runOf(runId)).toMatchObject({
      status: "DISPATCHED",
      externalSessionId: "sess_1",
      budgetCents: 2500,
      runVaultId: "vault_2",
      runCredentialId: runCredential.id,
    });
  });

  it("holds to the monthly limit across active runs", async () => {
    const s = await setup({ monthlyLimit: 25, runLimit: 25 });
    await dispatched(s, "First");
    // The first run reserves its whole $25 budget, so nothing is left.
    const { runId } = await dispatched(s, "Second");
    expect(await runOf(runId)).toMatchObject({ status: "FAILED", error: expect.stringContaining("$25 monthly limit") });
    expect(openai.sessions).toHaveLength(1);
  });

  it("reconciles: cost, waiting for input, approvals, failures and budgets", async () => {
    const s = await setup();
    const { runId, issue } = await dispatched(s);
    await claimIssue(s.agentCtx, `WEB-${issue.number}`);
    openai.spend = { limit: 2500, consumed: 312 };
    await sync(runId);
    expect(await runOf(runId)).toMatchObject({ status: "RUNNING", costCents: 312 });

    openai.status = "idle";
    await sync(runId);
    expect((await runOf(runId)).status).toBe("NEEDS_INPUT");

    openai.status = "requires_action";
    openai.requiredActions = [{ type: "mcp_approval_request", request_id: "req_1", turn_id: "t1", request: {} }];
    await sync(runId);
    const denied = openai.sent.flatMap((x) => x.events).find((e) => e.type === "agent.session.input.mcp_approval_request_result");
    expect(denied).toMatchObject({ request_id: "req_1", response: { decision: "deny" } });

    openai.requiredActions = [{ type: "function_call", call_id: "c1" }];
    await sync(runId);
    expect(await runOf(runId)).toMatchObject({ status: "FAILED", error: "Needed something Kanso can't provide" });
  });

  it("fails a run over budget, and a failed or never-claimed session", async () => {
    const s = await setup();
    const a = await dispatched(s, "A");
    openai.spend = { limit: 2500, consumed: 2600 };
    await sync(a.runId);
    expect(await runOf(a.runId)).toMatchObject({ status: "FAILED", error: "Reached its $25 run limit" });

    openai.spend = { limit: 2500, consumed: 0 };
    const b = await dispatched(s, "B");
    openai.status = "failed";
    openai.error = "Environment setup failed";
    await sync(b.runId);
    expect(await runOf(b.runId)).toMatchObject({ status: "FAILED", error: "The session failed: Environment setup failed" });

    const c = await dispatched(s, "C");
    openai.status = "idle";
    openai.error = null;
    await sync(c.runId);
    expect(await runOf(c.runId)).toMatchObject({ status: "FAILED", error: "Stopped without claiming the issue" });

    // Failing a run cancels its turn and deletes its vault.
    const cancels = openai.sent.filter((x) => x.events.some((e) => e.type === "agent.session.input.cancel"));
    expect(cancels.map((x) => x.sessionId).sort()).toEqual(["sess_1", "sess_2", "sess_3"]);
    expect(openai.deletedVaults.sort()).toEqual(["vault_2", "vault_3", "vault_4"]);
    expect(await runOf(a.runId)).toMatchObject({ runVaultId: null, runCredentialId: null });
  });

  it("renews the push token in the run vault once it's half an hour old", async () => {
    const s = await setup();
    const { runId } = await dispatched(s);
    await renewOpenAiGitHubAccess({ runId });
    expect(openai.credentialUpdates).toHaveLength(0);

    await renewOpenAiGitHubAccess({ runId }, new Date(Date.now() + 31 * 60_000));
    const run = await runOf(runId);
    expect(openai.credentialUpdates).toEqual([
      { id: run.runCredentialId, params: { vault_id: "vault_2", auth: { type: "environment_variable", secret_value: expect.any(String) } } },
    ]);
    const value = (openai.credentialUpdates[0]!.params.auth as { secret_value: string }).secret_value;
    expect(decode(value)).toBe(`x-access-token:${github.tokens.at(-1)!.token}`);
  });

  it("sends a member's comment once and resumes a waiting run; a guest's isn't sent", async () => {
    const s = await setup();
    const { runId, issue } = await dispatched(s);
    await claimIssue(s.agentCtx, `WEB-${issue.number}`);
    await reportProgress(s.agentCtx, `WEB-${issue.number}`, { message: "Which page?", status: "needs_input" });

    const comment = await addComment(s.member, issue.id, { body: "The login page." });
    await flushDeferred();
    const forwarded = openai.sent.find((x) => x.events[0]?.type === "agent.session.input.message")!;
    expect(forwarded.idempotencyKey).toBe(`kanso-comment-${comment.id}`);
    expect(JSON.stringify(forwarded.events)).toContain("The login page.");
    expect((await runOf(runId)).status).toBe("RUNNING");

    const guestUser = await makeUser("Gil");
    const guest = await addMember(s.workspace.id, guestUser, "GUEST");
    await db.projectAccess.create({
      data: { projectId: s.web.project.id, membershipId: (await db.membership.findFirstOrThrow({ where: { userId: guestUser.id } })).id },
    });
    const before = openai.sent.length;
    await addComment(guest, issue.id, { body: "From a guest" });
    await flushDeferred();
    expect(openai.sent.length).toBe(before);
  });

  it("opens the pull request for the OpenAI workspace agent", async () => {
    const s = await setup();
    const { runId, issue } = await dispatched(s);
    const key = `WEB-${issue.number}`;
    await claimIssue(s.agentCtx, key);
    const pr = await openPullRequest(s.agentCtx, key, { branch: "web-1-fix-login-redirect", title: "Fix login redirect" });
    expect(pr).toEqual({ url: "https://github.com/acme/web/pull/7", number: 7 });
    expect(github.pulls[0]).toMatchObject({ head: "web-1-fix-login-redirect", base: "develop" });
    expect((await runOf(runId)).status).toBe("PR_OPEN");
  });
});
