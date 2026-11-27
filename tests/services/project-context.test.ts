import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { flushDeferred } from "@/lib/defer";
import { assignAgent, claimIssue, createAgent, reportProgress } from "@/lib/services/agents";
import { ctxForApiToken } from "@/lib/services/api-tokens";
import type { Ctx } from "@/lib/services/context";
import {
  addEntry,
  CONTEXT_BUDGET,
  decideEntry,
  filesSchema,
  getProjectContext,
  getRenderedContext,
  issueOverlaps,
  listBriefRevisions,
  projectOverlaps,
  proposeEntry,
  renderContext,
  restoreBriefRevision,
  RUN_PROPOSAL_LIMIT,
  saveBrief,
} from "@/lib/services/project-context";

import { addMember, makeTeam, makeUser, shareProject } from "../factories";
import { expectStatus, makeIssue, makeProject } from "../helpers";

/** docs/features/27-project-context.md */

async function setup() {
  const team = await makeTeam();
  const web = await makeProject(team.ctx, "Web", "WEB");
  return { ...team, web };
}

/** An MCP agent assigned to a fresh issue, claimed, with a Ctx for its token. */
async function claimedByAgent(ctx: Ctx, todoColumnId: string, title = "Fix login") {
  const { agent, secrets } = await createAgent(ctx, { kind: "MCP", name: `Bot ${title}`, webhookUrl: null });
  const agentCtx = (await ctxForApiToken(secrets.token!))!;
  const issue = await makeIssue(ctx, todoColumnId, title);
  const { runId } = await assignAgent(ctx, issue.id, { agentId: agent.id });
  await flushDeferred();
  await claimIssue(agentCtx, `WEB-${issue.number}`);
  return { agent, agentCtx, issue, runId: runId! };
}

/** The same person, through an MCP client (ChatGPT, Claude Code…). */
const viaMcp = (ctx: Ctx): Ctx => ({ ...ctx, via: "mcp", limits: { write: true, projectIds: null } });

describe("rendering", () => {
  const project = { key: "WEB", name: "Web" };
  const entry = (kind: "DECISION" | "CONSTRAINT" | "CONVENTION" | "VOCABULARY", text: string, at = "2026-10-03") => ({
    kind,
    text,
    source: { issueId: "i", key: "WEB-112", title: "t", fromGitHub: false },
    sourcePrUrl: null,
    decidedBy: { id: "u", name: "Priya" },
    decidedAt: new Date(`${at}T00:00:00Z`),
    createdAt: new Date(`${at}T00:00:00Z`),
  });

  it("puts the brief first, then sections in order, newest first, with sources", () => {
    const { markdown, pages } = renderContext({
      project,
      brief: "We build the web app.",
      entries: [entry("VOCABULARY", "Account = billing entity"), entry("DECISION", "Cookies, not JWTs"), entry("DECISION", "Older decision", "2026-09-01")],
    });
    expect(pages).toBe(1);
    expect(markdown.indexOf("## Brief")).toBeLessThan(markdown.indexOf("## Decisions"));
    expect(markdown.indexOf("## Decisions")).toBeLessThan(markdown.indexOf("## Vocabulary"));
    expect(markdown.indexOf("Cookies, not JWTs")).toBeLessThan(markdown.indexOf("Older decision"));
    expect(markdown).toContain("- Cookies, not JWTs (WEB-112 · accepted by Priya, 3 Oct)");
    expect(markdown).not.toContain("## Constraints");
  });

  it("stays within the budget and pages the rest with a footer", () => {
    const entries = Array.from({ length: 80 }, (_, i) => entry("DECISION", `Decision ${i} ${"x".repeat(900)}`));
    const first = renderContext({ project, brief: "b".repeat(20_000), entries });
    expect(first.markdown.length).toBeLessThanOrEqual(CONTEXT_BUDGET);
    expect(first.pages).toBeGreaterThan(1);
    expect(first.markdown).toMatch(/_\d+ more entries not shown: call get_project_context with page 2\._/);

    let seen = first.entriesShown;
    for (let page = 2; page <= first.pages; page++) {
      const next = renderContext({ project, brief: "b".repeat(20_000), entries, page });
      expect(next.markdown.length).toBeLessThanOrEqual(CONTEXT_BUDGET);
      expect(next.markdown).not.toContain("## Brief");
      seen += next.entriesShown;
    }
    expect(seen).toBe(80);
  });
});

describe("brief", () => {
  it("saves with versions, refuses a stale save, and restores as a new version", async () => {
    const { ctx, web } = await setup();
    await saveBrief(ctx, web.project.id, { body: "First", version: 0 });
    await saveBrief(ctx, web.project.id, { body: "Second", version: 1 });
    await expectStatus(saveBrief(ctx, web.project.id, { body: "Stale", version: 1 }), 409);

    const restored = await restoreBriefRevision(ctx, web.project.id, 1);
    expect(restored).toMatchObject({ body: "First", version: 3 });
    expect((await listBriefRevisions(ctx, web.project.id)).map((r) => r.version)).toEqual([3, 2, 1]);
  });

  it("can be edited only by members in the web app", async () => {
    const { ctx, web, workspace } = await setup();
    const guest = await addMember(workspace.id, await makeUser("Gil"), "GUEST");
    await shareProject(workspace.id, guest.actor.type === "user" ? guest.actor.userId : "", web.project.id);
    await expectStatus(saveBrief(guest, web.project.id, { body: "x", version: 0 }), 403);
    await expectStatus(saveBrief(viaMcp(ctx), web.project.id, { body: "x", version: 0 }), 403);
    // Guests with the project shared can read it.
    await saveBrief(ctx, web.project.id, { body: "Shared brief", version: 0 });
    expect((await getRenderedContext(guest, { id: web.project.id })).markdown).toContain("Shared brief");
  });
});

describe("entries", () => {
  it("serves only what a person accepted", async () => {
    const { ctx, web } = await setup();
    const { agentCtx } = await claimedByAgent(ctx, web.todo.id);

    const { entry } = await proposeEntry(agentCtx, "WEB", { kind: "DECISION", text: "Use cookies", issueKey: "WEB-1" });
    expect(entry).toMatchObject({ status: "PROPOSED", proposedBy: { type: "agent" }, source: { key: "WEB-1" } });
    expect((await getRenderedContext(ctx, { key: "WEB" })).markdown).not.toContain("Use cookies");

    await decideEntry(ctx, entry.id, { action: "accept" });
    expect((await getRenderedContext(ctx, { key: "WEB" })).markdown).toContain("Use cookies");
  });

  it("makes everything through MCP a proposal, even from a person, and skips duplicates", async () => {
    const { ctx, web } = await setup();
    await addEntry(ctx, web.project.id, { kind: "CONSTRAINT", text: "API v1 stays compatible" });
    const viaChatGpt = await proposeEntry(viaMcp(ctx), "WEB", { kind: "VOCABULARY", text: "Account = billing entity" });
    expect(viaChatGpt.entry).toMatchObject({ status: "PROPOSED", proposedBy: { type: "user" } });

    const again = await proposeEntry(viaMcp(ctx), "WEB", { kind: "CONSTRAINT", text: "api v1  stays compatible" });
    expect(again.duplicate).toBe(true);
    // People can't accept through MCP either.
    await expectStatus(decideEntry(viaMcp(ctx), viaChatGpt.entry.id, { action: "accept" }), 403);
  });

  it("attributes a person's proposal to the agent run they're working (Claude Code)", async () => {
    const { ctx, web } = await setup();
    const { agent, runId } = await claimedByAgent(ctx, web.todo.id);
    const { entry } = await proposeEntry(viaMcp(ctx), "WEB", { kind: "DECISION", text: "Retry twice", issueKey: "WEB-1" });
    expect(entry).toMatchObject({ proposedBy: { type: "agent", id: agent.id }, runId });
  });

  it("caps pending proposals per run", async () => {
    const { ctx, web } = await setup();
    const { agentCtx } = await claimedByAgent(ctx, web.todo.id);
    for (let i = 0; i < RUN_PROPOSAL_LIMIT; i++) {
      await proposeEntry(agentCtx, "WEB", { kind: "DECISION", text: `Fact ${i}`, issueKey: "WEB-1" });
    }
    await expectStatus(proposeEntry(agentCtx, "WEB", { kind: "DECISION", text: "One too many", issueKey: "WEB-1" }), 429);
  });

  it("lets members decide, but not guests or agents; read-only tokens can't propose", async () => {
    const { ctx, web, workspace } = await setup();
    const { agentCtx } = await claimedByAgent(ctx, web.todo.id);
    const { entry } = await proposeEntry(agentCtx, "WEB", { kind: "DECISION", text: "X", issueKey: "WEB-1" });
    const member = await addMember(workspace.id, await makeUser("Mo"), "MEMBER");
    const guest = await addMember(workspace.id, await makeUser("Gil"), "GUEST");

    await expectStatus(decideEntry(agentCtx, entry.id, { action: "accept" }), 403);
    await expectStatus(decideEntry(guest, entry.id, { action: "accept" }), 403);
    const readOnly: Ctx = { ...ctx, via: "api_token", limits: { write: false, projectIds: null } };
    await expectStatus(proposeEntry(readOnly, "WEB", { kind: "DECISION", text: "Y" }), 403);

    const edited = await decideEntry(member, entry.id, { action: "accept", text: "X, edited" });
    expect(edited).toMatchObject({ status: "ACCEPTED", text: "X, edited", decidedBy: { name: "Mo" } });
    await expectStatus(decideEntry(member, entry.id, { action: "reject" }), 409);
  });

  it("replaces an accepted entry once, and hides the old one from agents", async () => {
    const { ctx, web } = await setup();
    const old = await addEntry(ctx, web.project.id, { kind: "DECISION", text: "Old way" });
    const newer = await addEntry(ctx, web.project.id, { kind: "DECISION", text: "New way", replacesId: old.id });
    expect(newer.replacesId).toBe(old.id);

    const rendered = (await getRenderedContext(ctx, { key: "WEB" })).markdown;
    expect(rendered).toContain("New way");
    expect(rendered).not.toContain("Old way");
    const all = await getProjectContext(ctx, web.project.id);
    expect(all.entries.find((e) => e.id === old.id)).toMatchObject({ replacedById: newer.id });

    await expectStatus(addEntry(ctx, web.project.id, { kind: "DECISION", text: "Third", replacesId: old.id }), 409);
    // Only accepted entries can be replaced.
    const { entry: pending } = await proposeEntry(viaMcp(ctx), "WEB", { kind: "DECISION", text: "Pending" });
    await expectStatus(addEntry(ctx, web.project.id, { kind: "DECISION", text: "Nope", replacesId: pending.id }), 400);
  });

  it("archives entries out of what agents get", async () => {
    const { ctx, web } = await setup();
    const entry = await addEntry(ctx, web.project.id, { kind: "CONVENTION", text: "Tabs" });
    await decideEntry(ctx, entry.id, { action: "archive" });
    expect((await getRenderedContext(ctx, { key: "WEB" })).markdown).not.toContain("Tabs");
  });
});

describe("overlaps", () => {
  const repoRows = async (ctx: Ctx, projectId: string) => {
    const installation = await db.gitHubInstallation.create({
      data: { workspaceId: ctx.workspaceId, installationId: 77, accountLogin: "acme", accountType: "Organization" },
    });
    await db.projectRepo.create({ data: { projectId, installationId: installation.id, repoFullName: "acme/web" } });
  };
  const pr = (issueId: string, number: number, files: string[], repoFullName = "acme/web", state: "OPEN" | "MERGED" = "OPEN") =>
    db.pullRequestLink.create({
      data: { issueId, repoFullName, number, url: `https://github.com/${repoFullName}/pull/${number}`, title: "t", branch: `b${number}`, state, files },
    });

  it("finds PR/PR, PR/planned and planned/planned overlaps in the same repository", async () => {
    const { ctx, web } = await setup();
    await repoRows(ctx, web.project.id);
    const a = await makeIssue(ctx, web.todo.id, "A");
    const b = await makeIssue(ctx, web.todo.id, "B");
    await pr(a.id, 1, ["src/auth/session.ts", "README.md"]);
    await pr(b.id, 2, ["src/auth/session.ts"]);
    expect(await issueOverlaps(ctx, a.id)).toEqual([
      expect.objectContaining({ key: "WEB-2", files: ["src/auth/session.ts"], pullRequest: expect.objectContaining({ number: 2 }) }),
    ]);

    const { agentCtx, issue: c } = await claimedByAgent(ctx, web.todo.id, "C");
    const { issueId } = await reportProgress(agentCtx, `WEB-${c.number}`, { message: "Starting", files: ["./README.md", "src/new.ts"] });
    expect(issueId).toBe(c.id);
    expect((await issueOverlaps(ctx, c.id)).map((o) => [o.key, o.files])).toEqual([["WEB-1", ["README.md"]]]);
    expect((await issueOverlaps(ctx, a.id)).map((o) => o.key).sort()).toEqual(["WEB-2", "WEB-3"]);
    expect(Object.keys(await projectOverlaps(ctx, web.project.id)).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("ignores other repositories and finished work", async () => {
    const { ctx, web } = await setup();
    const a = await makeIssue(ctx, web.todo.id, "A");
    const b = await makeIssue(ctx, web.todo.id, "B");
    const d = await makeIssue(ctx, web.todo.id, "D");
    await pr(a.id, 1, ["src/x.ts"]);
    await pr(b.id, 2, ["src/x.ts"], "acme/other");
    await pr(d.id, 3, ["src/x.ts"], "acme/web", "MERGED");
    expect(await issueOverlaps(ctx, a.id)).toEqual([]);
  });

  it("validates reported paths", () => {
    expect(filesSchema.parse(["./src/a.ts"])).toEqual(["src/a.ts"]);
    for (const bad of [["/etc/passwd"], ["src/../../x"], ["C:\\x"], ["a\u0000b"]]) {
      expect(filesSchema.safeParse(bad).success).toBe(false);
    }
    expect(filesSchema.safeParse(Array.from({ length: 301 }, (_, i) => `f${i}`)).success).toBe(false);
  });
});
