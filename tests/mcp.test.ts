import { createMcpHandler } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it } from "vitest";

import { flushDeferred } from "@/lib/defer";
import { MCP_SCOPES } from "@/lib/mcp/config";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { hitRateLimit, resetRateLimits } from "@/lib/mcp/rate-limit";
import { createKansoMcpServer } from "@/lib/mcp/server";
import { listIssueActivity } from "@/lib/services/activity";
import { assignAgent, createAgent } from "@/lib/services/agents";
import { createApiToken, ctxForApiToken } from "@/lib/services/api-tokens";
import { listComments } from "@/lib/services/comments";
import { getIssueByKey } from "@/lib/services/issues";
import { createLabel } from "@/lib/services/labels";
import { createWorkspace } from "@/lib/services/workspaces";
import { addMember, makeTeam, makeUser, shareProject } from "@/tests/factories";
import { makeIssue, makeProject } from "@/tests/helpers";

/**
 * The MCP server end to end (JSON-RPC over the SDK's HTTP handler), minus the
 * credential check in app/api/mcp, which hands the server a principal.
 */

const handler = createMcpHandler(({ authInfo }) =>
  createKansoMcpServer(authInfo!.extra!.principal as McpPrincipal),
);

let id = 0;
async function rpc(principal: McpPrincipal, method: string, params: Record<string, unknown> = {}) {
  const request = new Request("http://localhost/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
  });
  const response = await handler.fetch(request, {
    authInfo: { token: "t", clientId: "test", scopes: [], extra: { principal } },
  });
  const text = await response.text();
  const json = response.headers.get("content-type")?.includes("text/event-stream")
    ? JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).at(-1)!.slice(5))
    : JSON.parse(text);
  return { status: response.status, ...json } as {
    status: number;
    result?: Record<string, unknown> & {
      isError?: boolean;
      content?: { text: string }[];
      structuredContent?: Record<string, unknown>;
    };
    error?: { code: number; message: string } | string;
  };
}

/** The structured results these tests read (each tool returns some of these). */
type ToolData = {
  [key: string]: unknown;
  count: number;
  created: string;
  title: string;
  issues: { key: string }[];
  projects: { key: string }[];
};

async function tool(principal: McpPrincipal, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(principal, "tools/call", { name, arguments: args });
  return {
    status: res.status,
    error: res.error,
    isError: res.result?.isError ?? false,
    text: res.result?.content?.[0]?.text ?? "",
    data: res.result?.structuredContent as ToolData | undefined,
  };
}

async function tokenPrincipal(...args: Parameters<typeof createApiToken>): Promise<McpPrincipal> {
  const { secret } = await createApiToken(...args);
  return { kind: "api_token", ctx: (await ctxForApiToken(secret))! };
}

const oauth = (userId: string, scopes = [MCP_SCOPES.read, MCP_SCOPES.write]): McpPrincipal => ({
  kind: "oauth",
  userId,
  clientId: "client",
  scopes,
});

async function setup() {
  const owner = await makeTeam("Acme", "Olivia");
  const web = await makeProject(owner.ctx, "Web", "WEB");
  const ops = await makeProject(owner.ctx, "Ops", "OPS");
  await createLabel(owner.ctx, web.project.id, { name: "frontend", color: "#3366ff" });
  return { owner, web, ops };
}

beforeEach(() => resetRateLimits());

describe("MCP server", () => {
  it("lists tools with annotations, resources, and prompts", async () => {
    const { owner } = await setup();
    const principal = await tokenPrincipal(owner.ctx, { name: "r" });
    const tools = (await rpc(principal, "tools/list")).result!.tools as {
      name: string;
      annotations: { readOnlyHint?: boolean; destructiveHint?: boolean };
    }[];
    expect(tools.map((t) => t.name)).toEqual([
      "whoami",
      "list_workspaces",
      "list_projects",
      "get_project",
      "search_issues",
      "get_issue",
      "get_my_work",
      "create_issue",
      "update_issue",
      "move_issue",
      "create_subtasks",
      "assign_issue",
      "add_comment",
      "list_agent_queue",
      "claim_issue",
      "report_progress",
      "release_issue",
      "bulk_update_issues",
    ]);
    expect(tools.find((t) => t.name === "get_issue")!.annotations.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "create_issue")!.annotations.readOnlyHint).toBe(false);

    const templates = (await rpc(principal, "resources/templates/list")).result!.resourceTemplates as {
      uriTemplate: string;
    }[];
    expect(templates.map((t) => t.uriTemplate)).toEqual([
      "issue://{workspace}/{key}",
      "project://{workspace}/{key}/workflow",
    ]);
    const prompts = (await rpc(principal, "prompts/list")).result!.prompts as { name: string }[];
    expect(prompts.map((p) => p.name)).toEqual(["break_down_epic", "plan_sprint", "write_standup"]);
  });

  it("creates and moves issues by name, recorded as API-token activity", async () => {
    const { owner } = await setup();
    const principal = await tokenPrincipal(owner.ctx, { name: "w", access: "WRITE" });

    const created = await tool(principal, "create_issue", {
      project: "web",
      title: "Fix login",
      type: "BUG",
      status: "in progress",
      assignee: "me",
      labels: ["Frontend"],
      dueDate: "2026-12-01",
    });
    expect(created.isError, created.text).toBe(false);
    expect(created.data).toMatchObject({
      created: "WEB-1",
      issue: { status: "In Progress (IN_PROGRESS)", assignee: "Olivia", labels: ["frontend"], dueDate: "2026-12-01" },
    });

    const moved = await tool(principal, "move_issue", { key: "WEB-1", status: "Done" });
    expect(moved.data).toEqual({ key: "WEB-1", status: "Done (DONE)" });

    const issue = await getIssueByKey(owner.ctx, "WEB-1");
    const { entries } = await listIssueActivity(owner.ctx, issue.id);
    expect(entries.map((e) => e.action)).toContain("issue.moved");
    expect(entries.every((e) => (e.data as { via?: string }).via === "api_token")).toBe(true);

    const subtasks = await tool(principal, "create_subtasks", { key: "WEB-1", titles: ["a", "b"] });
    expect(subtasks.data).toEqual({ parent: "WEB-1", created: ["WEB-2", "WEB-3"] });

    const bulk = await tool(principal, "bulk_update_issues", {
      keys: ["WEB-2", "WEB-3"],
      changes: { priority: "HIGH", assignee: "me" },
    });
    expect(bulk.data).toMatchObject({ updated: ["WEB-2", "WEB-3"], failed: [] });
    const mine = await tool(principal, "get_my_work");
    expect(mine.data!.issues.map((i: { key: string }) => i.key).sort()).toEqual(["WEB-2", "WEB-3"]);
  });

  it("explains unknown names with the valid choices and writes nothing", async () => {
    const { owner } = await setup();
    const principal = await tokenPrincipal(owner.ctx, { name: "w", access: "WRITE" });
    const badStatus = await tool(principal, "create_issue", { project: "WEB", title: "x", status: "Shipped" });
    expect(badStatus.isError).toBe(true);
    expect(badStatus.text).toContain('"To Do", "In Progress", "Done"');
    const badLabel = await tool(principal, "create_issue", { project: "WEB", title: "x", labels: ["nope"] });
    expect(badLabel.text).toContain("Labels: frontend");
    const badAssignee = await tool(principal, "create_issue", { project: "WEB", title: "x", assignee: "zed@x.test" });
    expect(badAssignee.text).toContain("Olivia <");
    expect((await tool(principal, "search_issues", { query: "project:WEB" })).data!.count).toBe(0);
  });

  it("keeps read-only credentials read-only", async () => {
    const { owner, web } = await setup();
    await makeIssue(owner.ctx, web.todo.id, "Existing");
    const principal = await tokenPrincipal(owner.ctx, { name: "r" });
    expect((await tool(principal, "get_issue", { key: "WEB-1" })).data!.title).toBe("Existing");
    const write = await tool(principal, "add_comment", { key: "WEB-1", body: "hi" });
    expect(write.isError).toBe(true);
    expect(write.text).toContain("read-only");
  });

  it("hides everything outside a project-limited token's projects", async () => {
    const { owner, web, ops } = await setup();
    await makeIssue(owner.ctx, web.todo.id, "Web work");
    await makeIssue(owner.ctx, ops.todo.id, "Ops work");
    const principal = await tokenPrincipal(owner.ctx, { name: "ops", access: "WRITE", projectIds: [ops.project.id] });

    expect((await tool(principal, "list_projects")).data!.projects.map((p: { key: string }) => p.key)).toEqual(["OPS"]);
    expect((await tool(principal, "get_project", { project: "WEB" })).text).toBe("Project not found");
    expect((await tool(principal, "get_issue", { key: "WEB-1" })).text).toBe("Issue not found");
    expect((await tool(principal, "search_issues", { query: "work" })).data!.issues.map((i: { key: string }) => i.key)).toEqual([
      "OPS-1",
    ]);
    expect((await tool(principal, "create_issue", { project: "WEB", title: "x" })).text).toBe("Project not found");
    expect((await tool(principal, "create_issue", { project: "OPS", title: "ok" })).data!.created).toBe("OPS-2");
    const resource = await rpc(principal, "resources/read", { uri: `issue://${owner.workspace.slug}/WEB-1` });
    expect(resource.error).toMatchObject({ message: "Issue not found" });
  });

  it("keeps guests to commenting on shared projects", async () => {
    const { owner, web, ops } = await setup();
    await makeIssue(owner.ctx, web.todo.id, "Shared");
    await makeIssue(owner.ctx, ops.todo.id, "Hidden");
    const guestUser = await makeUser("Gil");
    await addMember(owner.workspace.id, guestUser, "GUEST");
    await shareProject(owner.workspace.id, guestUser.id, web.project.id);
    const principal = oauth(guestUser.id);

    expect((await tool(principal, "list_projects")).data!.projects.map((p: { key: string }) => p.key)).toEqual(["WEB"]);
    expect((await tool(principal, "get_issue", { key: "OPS-1" })).text).toBe("Issue not found");
    expect((await tool(principal, "create_issue", { project: "WEB", title: "x" })).text).toBe(
      "You don't have permission to do that",
    );
    expect((await tool(principal, "move_issue", { key: "WEB-1", status: "done" })).isError).toBe(true);
    expect((await tool(principal, "add_comment", { key: "WEB-1", body: "Looks good" })).isError).toBe(false);
    // Guests aren't assignable either.
    const assign = await tool(oauth(owner.user.id), "assign_issue", { key: "WEB-1", assignee: guestUser.email });
    expect(assign.isError).toBe(true);
  });

  it("challenges OAuth tokens without kanso:write instead of running write tools", async () => {
    const { owner, web } = await setup();
    await makeIssue(owner.ctx, web.todo.id, "Existing");
    const principal = oauth(owner.user.id, [MCP_SCOPES.read]);
    expect((await tool(principal, "get_issue", { key: "WEB-1" })).isError).toBe(false);
    const write = await tool(principal, "add_comment", { key: "WEB-1", body: "hi" });
    // An HTTP 403 insufficient_scope step-up, so the client can re-authorize.
    expect(write.status).toBe(403);
    expect(write.error).toBe("insufficient_scope");
    const issue = await getIssueByKey(owner.ctx, "WEB-1");
    expect(await listComments(owner.ctx, issue.id)).toEqual([]);
  });

  it("picks the OAuth user's workspace by slug, or the only one", async () => {
    const { owner } = await setup();
    const principal = oauth(owner.user.id);
    expect((await tool(principal, "list_projects")).isError).toBe(false);

    const second = await createWorkspace(owner.user.id, { name: "Beta" });
    const ambiguous = await tool(principal, "list_projects");
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.text).toContain(second.slug);
    expect((await tool(principal, "list_projects", { workspace: second.slug })).data!.projects).toEqual([]);
    expect((await tool(principal, "list_projects", { workspace: "nope" })).isError).toBe(true);

    const apiPrincipal = await tokenPrincipal(owner.ctx, { name: "r" });
    expect((await tool(apiPrincipal, "list_projects", { workspace: second.slug })).text).toContain(
      "only works in",
    );
  });
});

describe("agent tools", () => {
  it("an agent token sees its queue, claims, reports, and releases over MCP", async () => {
    const { owner, web } = await setup();
    const { agent, secrets } = await createAgent(owner.ctx, { kind: "MCP", name: "Bot", webhookUrl: null });
    const issue = await makeIssue(owner.ctx, web.todo.id, "Fix login");
    await assignAgent(owner.ctx, issue.id, { agentId: agent.id });
    await flushDeferred();
    const principal: McpPrincipal = { kind: "api_token", ctx: (await ctxForApiToken(secrets.token!))! };

    const queue = await tool(principal, "list_agent_queue");
    expect(queue.data!.issues.map((i) => i.key)).toEqual(["WEB-1"]);

    const claim = await tool(principal, "claim_issue", { key: "WEB-1" });
    expect(claim.isError).toBe(false);
    expect(claim.data).toMatchObject({ branch: "web-1-fix-login", run: { status: "RUNNING" } });

    const report = await tool(principal, "report_progress", { key: "WEB-1", message: "PR coming" });
    expect(report.isError).toBe(false);
    expect((await listComments(owner.ctx, issue.id)).at(-1)).toMatchObject({ body: "PR coming", authorAgentId: agent.id });

    expect((await tool(principal, "release_issue", { key: "WEB-1", reason: "Stuck" })).isError).toBe(false);
    // Still assigned, so the agent can pick it up again (a new run).
    const again = await tool(principal, "claim_issue", { key: "WEB-1" });
    expect(again.data).toMatchObject({ run: { status: "RUNNING" } });
  });

  it("an OAuth user can't claim an issue assigned to someone else's agent", async () => {
    const { owner, web } = await setup();
    const { agent } = await createAgent(owner.ctx, { kind: "MCP", name: "Bot", webhookUrl: null });
    const issue = await makeIssue(owner.ctx, web.todo.id);
    await assignAgent(owner.ctx, issue.id, { agentId: agent.id });
    await flushDeferred();
    const other = await makeUser("Mo");
    await addMember(owner.workspace.id, other, "ADMIN");
    const claim = await tool(oauth(other.id), "claim_issue", { key: "WEB-1", workspace: owner.workspace.slug });
    expect(claim.isError).toBe(true);
    expect(claim.text).toContain("isn't your agent");
    const mine = await tool(oauth(owner.user.id), "claim_issue", { key: "WEB-1", workspace: owner.workspace.slug });
    expect(mine.isError).toBe(false);
  });
});

describe("rate limit", () => {
  it("allows 120 requests a minute per key, then asks to retry", () => {
    const now = 1_000_000;
    for (let i = 0; i < 120; i++) expect(hitRateLimit("k", now)).toBeNull();
    expect(hitRateLimit("k", now + 15_000)).toBe(45);
    expect(hitRateLimit("other", now)).toBeNull();
    expect(hitRateLimit("k", now + 60_000)).toBeNull();
  });
});
