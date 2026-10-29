import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GET as cronGET } from "@/app/api/cron/github-sync/route";
import { POST as webhookPOST } from "@/app/api/github/webhooks/route";
import { hmacHex, signState } from "@/lib/crypto";
import { db } from "@/lib/db";
import { flushDeferred } from "@/lib/defer";
import { branchName } from "@/lib/github/branch";
import { combineChecks, extractIssueKeys } from "@/lib/github/webhooks";
import type { Ctx } from "@/lib/services/context";
import {
  completeGitHubCallback,
  connectRepo,
  disconnectRepo,
  getGitHubSettings,
  listInstallationRepos,
  removeInstallation,
  startGitHubInstall,
  startGitHubLink,
  syncProjectRepo,
  unlinkGitHub,
  updateProjectRepo,
} from "@/lib/services/github";
import { getIssue, moveIssue } from "@/lib/services/issues";

import { addMember, makeTeam, makeUser } from "../factories";
import { configureGitHubEnv, fakeGitHub, resetGitHub, WEBHOOK_SECRET } from "../fake-github";
import { expectStatus, makeIssue, makeProject } from "../helpers";

beforeAll(() => configureGitHubEnv());
afterAll(() => resetGitHub());

let gh: ReturnType<typeof fakeGitHub>;
beforeEach(() => {
  gh = fakeGitHub();
});

const installState = (ctx: Ctx, kind: "install" | "link" = "install") =>
  signState({ kind, workspaceId: ctx.workspaceId, userId: (ctx.actor as { userId: string }).userId });

/** A team with an installed app (installation 77) and its row id. */
async function installedTeam() {
  const team = await makeTeam();
  await completeGitHubCallback(team.user.id, {
    code: "good-code",
    state: installState(team.ctx),
    installationId: "77",
    setupAction: "install",
  });
  const installation = await db.gitHubInstallation.findUniqueOrThrow({ where: { installationId: 77 } });
  return { ...team, installation };
}

let delivery = 0;
async function deliver(event: string, payload: unknown, secret = WEBHOOK_SECRET) {
  const body = JSON.stringify(payload);
  const id = `d-${++delivery}`;
  const response = await webhookPOST(
    new Request("http://localhost/api/github/webhooks", {
      method: "POST",
      body,
      headers: {
        "x-github-event": event,
        "x-github-delivery": id,
        "x-hub-signature-256": `sha256=${hmacHex(secret, body)}`,
      },
    }),
  );
  return { response, id, body };
}

describe("install & link", () => {
  it("only admins can start an install; any member can link", async () => {
    const team = await makeTeam();
    expect(startGitHubInstall(team.ctx)).toContain("github.com/apps/kanso-test/installations/new?state=");
    const member = await addMember(team.workspace.id, await makeUser("Mo"), "MEMBER");
    expect(() => startGitHubInstall(member)).toThrow(expect.objectContaining({ status: 403 }));
    const guest = await addMember(team.workspace.id, await makeUser("Gil"), "GUEST");
    expect(startGitHubLink(guest)).toContain("login/oauth/authorize");
  });

  it("installs into the workspace and links the installer", async () => {
    const { ctx, user, installation } = await installedTeam();
    expect(installation).toMatchObject({ workspaceId: ctx.workspaceId, accountLogin: "acme" });
    const link = await db.gitHubUserLink.findUniqueOrThrow({ where: { userId: user.id } });
    expect(link).toMatchObject({ githubUserId: 1001, login: "ana-gh" });
    const settings = await getGitHubSettings(ctx);
    expect(settings).toMatchObject({ configured: true, canManage: true, link: { login: "ana-gh" } });
    expect(settings.installations).toHaveLength(1);
  });

  it("rejects forged, expired, or someone else's state", async () => {
    const team = await makeTeam();
    const input = { code: "good-code", installationId: "77" };
    await expectStatus(completeGitHubCallback(team.user.id, { ...input, state: "nope.nope" }), 400);
    const other = await makeUser("Eve");
    await expectStatus(completeGitHubCallback(other.id, { ...input, state: installState(team.ctx) }), 400);
    const expired = signState({ kind: "install", workspaceId: team.workspace.id, userId: team.user.id }, -1);
    await expectStatus(completeGitHubCallback(team.user.id, { ...input, state: expired }), 400);
    expect(await db.gitHubInstallation.count()).toBe(0);
  });

  it("refuses an install the user can't see, or one owned by another workspace", async () => {
    const team = await makeTeam();
    gh.state.userInstallations = [];
    await expectStatus(
      completeGitHubCallback(team.user.id, { code: "good-code", state: installState(team.ctx), installationId: "77" }),
      403,
    );
    gh.state.userInstallations = [77];
    await installedTeam();
    await expectStatus(
      completeGitHubCallback(team.user.id, { code: "good-code", state: installState(team.ctx), installationId: "77" }),
      409,
    );
  });

  it("a member's install state can't attach an installation", async () => {
    const team = await makeTeam();
    const member = await makeUser("Mo");
    const ctx = await addMember(team.workspace.id, member, "MEMBER");
    await expectStatus(
      completeGitHubCallback(member.id, { code: "good-code", state: installState(ctx), installationId: "77" }),
      403,
    );
  });

  it("one GitHub account maps to one user; unlink removes the link", async () => {
    const { workspace, ctx } = await installedTeam();
    const other = await makeUser("Bo");
    const otherCtx = await addMember(workspace.id, other, "MEMBER");
    await expectStatus(
      completeGitHubCallback(other.id, { code: "good-code", state: installState(otherCtx, "link") }),
      409,
    );
    await unlinkGitHub(ctx);
    expect(await db.gitHubUserLink.count()).toBe(0);
    await completeGitHubCallback(other.id, { code: "good-code", state: installState(otherCtx, "link") });
    expect((await db.gitHubUserLink.findFirstOrThrow()).userId).toBe(other.id);
  });
});

describe("repositories & import", () => {
  it("connecting needs admin; a repo maps to one project", async () => {
    const { ctx, workspace, installation } = await installedTeam();
    const { project } = await makeProject(ctx, "Web", "WEB");
    const member = await addMember(workspace.id, await makeUser("Mo"), "MEMBER");
    const input = { installationId: installation.id, repoFullName: "acme/web", projectId: project.id };
    await expectStatus(connectRepo(member, input), 403);
    await expectStatus(connectRepo(ctx, { ...input, repoFullName: "acme/other" }), 400);
    const repo = await connectRepo(ctx, { ...input, importIssues: "OFF" });
    expect(repo).toMatchObject({ repoFullName: "acme/web", importIssues: "OFF", statusSync: true });
    await expectStatus(connectRepo(ctx, input), 409);

    const repos = await listInstallationRepos(ctx, installation.id);
    expect(repos[0]).toMatchObject({ fullName: "acme/web", connected: { key: "WEB" } });
    await expectStatus(listInstallationRepos(member, installation.id), 403);

    await expectStatus(updateProjectRepo(member, repo.id, { statusSync: false }), 403);
    expect(await updateProjectRepo(ctx, repo.id, { statusSync: false })).toMatchObject({ statusSync: false });
    await disconnectRepo(ctx, repo.id);
    expect(await db.projectRepo.count()).toBe(0);
  });

  it("ASSIGNED mode imports open issues assigned to linked members once, into TODO, with labels", async () => {
    const { ctx, user, installation } = await installedTeam();
    const { project, todo } = await makeProject(ctx, "Web", "WEB");
    gh.state.issues["acme/web"] = [
      { number: 1, title: "Login broken", body: "Steps…", state: "open", assignees: ["ana-gh"], labels: [{ name: "bug", color: "d73a4a" }] },
      { number: 2, title: "Not mine", body: null, state: "open", assignees: ["someone"] },
      { number: 3, title: "Done already", body: null, state: "closed", assignees: ["ana-gh"] },
    ];
    const repo = await connectRepo(ctx, {
      installationId: installation.id,
      repoFullName: "acme/web",
      projectId: project.id,
      importIssues: "ASSIGNED",
    });
    await flushDeferred(); // connect kicks off an import

    const imported = await db.issue.findMany({ where: { projectId: project.id }, include: { labels: true, githubLink: true } });
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      title: "Login broken",
      description: "Steps…",
      source: "GITHUB",
      columnId: todo.id,
      assigneeUserId: user.id,
      githubLink: { repoFullName: "acme/web", number: 1, state: "OPEN" },
    });
    expect(imported[0]!.labels.map((l) => [l.name, l.color])).toEqual([["bug", "#d73a4a"]]);

    expect(await syncProjectRepo(ctx, repo.id)).toEqual({ imported: 0, updated: 0 });
    const activity = await db.activity.findFirstOrThrow({ where: { action: "issue.created" } });
    expect(activity).toMatchObject({ actorType: "GITHUB", data: expect.objectContaining({ via: "github" }) });
  });

  it("ALL mode imports every open issue; unassigned unless a linked member has it", async () => {
    const { ctx, user, installation } = await installedTeam();
    const { project } = await makeProject(ctx, "Web", "WEB");
    gh.state.issues["acme/web"] = [
      { number: 1, title: "Mine", body: null, state: "open", assignees: ["ana-gh"] },
      { number: 2, title: "Nobody's", body: null, state: "open", assignees: [] },
      { number: 3, title: "Outsider's", body: null, state: "open", assignees: ["someone"] },
      { number: 4, title: "Closed", body: null, state: "closed", assignees: [] },
    ];
    const repo = await connectRepo(ctx, { installationId: installation.id, repoFullName: "acme/web", projectId: project.id });
    expect(repo.importIssues).toBe("ALL");
    await flushDeferred();
    const issues = await db.issue.findMany({ where: { projectId: project.id }, orderBy: { title: "asc" } });
    expect(issues.map((i) => [i.title, i.assigneeUserId])).toEqual([
      ["Mine", user.id],
      ["Nobody's", null],
      ["Outsider's", null],
    ]);
    expect((await db.projectRepo.findUniqueOrThrow({ where: { id: repo.id } })).lastSyncedAt).not.toBeNull();
  });

  it("later syncs import new issues and apply closes webhooks missed", async () => {
    const { ctx, installation } = await installedTeam();
    const { project, done } = await makeProject(ctx, "Web", "WEB");
    gh.state.issues["acme/web"] = [{ number: 1, title: "First", body: null, state: "open", assignees: [] }];
    const repo = await connectRepo(ctx, { installationId: installation.id, repoFullName: "acme/web", projectId: project.id });
    await flushDeferred();
    const first = await db.issue.findFirstOrThrow({ where: { title: "First" } });

    // While Kanso was offline: #1 closed, #2 opened, and an old untouched issue wasn't returned.
    gh.state.issues["acme/web"] = [
      { number: 1, title: "First", body: null, state: "closed", assignees: [] },
      { number: 2, title: "Second", body: null, state: "open", assignees: [] },
      { number: 3, title: "Stale", body: null, state: "open", assignees: [], updatedAt: "2020-01-01T00:00:00Z" },
    ];
    expect(await syncProjectRepo(ctx, repo.id)).toEqual({ imported: 1, updated: 1 });
    expect((await getIssue(ctx, first.id)).column.id).toBe(done.id);
    expect(await db.issue.count({ where: { title: "Second" } })).toBe(1);
    expect(await db.issue.count({ where: { title: "Stale" } })).toBe(0);
  });

  it("switching a repo to OFF stops imports; back to ALL re-imports open issues", async () => {
    const { ctx, installation } = await installedTeam();
    const { project } = await makeProject(ctx, "Web", "WEB");
    const repo = await connectRepo(ctx, {
      installationId: installation.id,
      repoFullName: "acme/web",
      projectId: project.id,
      importIssues: "OFF",
    });
    gh.state.issues["acme/web"] = [{ number: 1, title: "Old", body: null, state: "open", assignees: [], updatedAt: "2020-01-01T00:00:00Z" }];
    await flushDeferred();
    expect(await db.issue.count()).toBe(0);
    await updateProjectRepo(ctx, repo.id, { importIssues: "ALL" });
    await flushDeferred();
    expect(await db.issue.count()).toBe(1);
  });

  it("guests are never import targets and can't sync", async () => {
    const { ctx, workspace, installation, user } = await installedTeam();
    await db.membership.update({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } },
      data: { role: "GUEST" },
    });
    const { project } = await makeProject(ctx, "Web", "WEB");
    gh.state.issues["acme/web"] = [{ number: 1, title: "A", body: null, state: "open", assignees: ["ana-gh"] }];
    const repo = await connectRepo(ctx, {
      installationId: installation.id,
      repoFullName: "acme/web",
      projectId: project.id,
      importIssues: "ASSIGNED",
    });
    await flushDeferred();
    expect(await db.issue.count()).toBe(0);
    const guest = await addMember(workspace.id, await makeUser("Gil"), "GUEST");
    await expectStatus(syncProjectRepo(guest, repo.id), 403);
  });

  it("removing an installation needs admin and drops its repo connections", async () => {
    const { ctx, workspace, installation } = await installedTeam();
    const { project } = await makeProject(ctx, "Web", "WEB");
    await connectRepo(ctx, { installationId: installation.id, repoFullName: "acme/web", projectId: project.id, importIssues: "OFF" });
    const member = await addMember(workspace.id, await makeUser("Mo"), "MEMBER");
    await expectStatus(removeInstallation(member, installation.id), 403);
    await removeInstallation(ctx, installation.id);
    expect(await db.projectRepo.count()).toBe(0);
  });
});

/** An installed team with acme/web connected to WEB and one imported issue. */
async function syncedIssue() {
  const team = await installedTeam();
  const board = await makeProject(team.ctx, "Web", "WEB");
  gh.state.issues["acme/web"] = [{ number: 5, title: "Fix it", body: null, state: "open", assignees: ["ana-gh"] }];
  await connectRepo(team.ctx, { installationId: team.installation.id, repoFullName: "acme/web", projectId: board.project.id });
  await flushDeferred();
  const issue = await db.issue.findFirstOrThrow({ where: { source: "GITHUB" } });
  return { ...team, ...board, issue };
}

describe("status sync", () => {
  it("moving into and out of DONE closes and reopens the GitHub issue", async () => {
    const { ctx, issue, done, doing } = await syncedIssue();
    await moveIssue(ctx, { issueId: issue.id, toColumnId: done.id, toPosition: 0 });
    await flushDeferred();
    expect(gh.calls.find((c) => c.method === "PATCH")).toMatchObject({
      path: "/repos/acme/web/issues/5",
      body: { state: "closed", state_reason: "completed" },
      auth: "Bearer inst-77",
    });
    expect((await db.gitHubIssueLink.findFirstOrThrow()).state).toBe("CLOSED");

    await moveIssue(ctx, { issueId: issue.id, toColumnId: doing.id, toPosition: 0 });
    await flushDeferred();
    expect(gh.calls.filter((c) => c.method === "PATCH").at(-1)?.body).toEqual({ state: "open" });
  });

  it("a GitHub failure doesn't undo the move", async () => {
    const { ctx, issue, done } = await syncedIssue();
    gh.state.failNextPatch = true;
    await moveIssue(ctx, { issueId: issue.id, toColumnId: done.id, toPosition: 0 });
    await flushDeferred();
    expect((await getIssue(ctx, issue.id)).column.id).toBe(done.id);
    expect((await db.gitHubIssueLink.findFirstOrThrow()).state).toBe("OPEN");
  });

  it("GitHub close/reopen moves the issue without echoing back", async () => {
    const { ctx, issue, done, todo } = await syncedIssue();
    const payload = (action: string, state: "open" | "closed") => ({
      action,
      installation: { id: 77 },
      repository: { full_name: "acme/web" },
      issue: { number: 5, title: "Fix it", body: null, html_url: "x", state, assignees: [], labels: [] },
    });
    expect((await deliver("issues", payload("closed", "closed"))).response.status).toBe(200);
    await flushDeferred();
    expect((await getIssue(ctx, issue.id)).column.id).toBe(done.id);
    expect(gh.calls.some((c) => c.method === "PATCH")).toBe(false);
    const moved = await db.activity.findFirstOrThrow({ where: { action: "issue.moved" } });
    expect(moved).toMatchObject({ actorType: "GITHUB", data: expect.objectContaining({ via: "github" }) });

    await deliver("issues", payload("reopened", "open"));
    expect((await getIssue(ctx, issue.id)).column.id).toBe(todo.id);
  });

  it("status sync off: no calls either way", async () => {
    const { ctx, issue, done } = await syncedIssue();
    const repo = await db.projectRepo.findFirstOrThrow();
    await updateProjectRepo(ctx, repo.id, { statusSync: false });
    await moveIssue(ctx, { issueId: issue.id, toColumnId: done.id, toPosition: 0 });
    await flushDeferred();
    expect(gh.calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("edits on GitHub update the title", async () => {
    const { ctx, issue } = await syncedIssue();
    await deliver("issues", {
      action: "edited",
      changes: { title: { from: "Fix it" } },
      installation: { id: 77 },
      repository: { full_name: "acme/web" },
      issue: { number: 5, title: "Fix it properly", body: null, html_url: "x", state: "open" },
    });
    expect((await getIssue(ctx, issue.id)).title).toBe("Fix it properly");
  });

  it("issues.opened imports unassigned issues in ALL mode, not in ASSIGNED", async () => {
    const { ctx } = await syncedIssue();
    const opened = (number: number) =>
      deliver("issues", {
        action: "opened",
        installation: { id: 77 },
        repository: { full_name: "acme/web" },
        issue: { number, title: `Issue ${number}`, body: null, html_url: "x", state: "open", assignees: [], labels: [] },
      });
    await opened(20);
    expect(await db.issue.findFirstOrThrow({ where: { title: "Issue 20" } })).toMatchObject({ assigneeUserId: null });
    const repo = await db.projectRepo.findFirstOrThrow();
    await updateProjectRepo(ctx, repo.id, { importIssues: "ASSIGNED" });
    await opened(21);
    expect(await db.issue.count({ where: { title: "Issue 21" } })).toBe(0);
  });

  it("issues.opened imports when assigned to a linked member", async () => {
    const { ctx, project } = await syncedIssue();
    await deliver("issues", {
      action: "opened",
      installation: { id: 77 },
      repository: { full_name: "acme/web" },
      issue: {
        number: 9,
        title: "New one",
        body: "b",
        html_url: "https://github.com/acme/web/issues/9",
        state: "open",
        assignees: [{ id: 1001, login: "ana-gh" }],
        labels: ["triage"],
      },
    });
    const imported = await db.issue.findFirstOrThrow({ where: { title: "New one" }, include: { labels: true } });
    expect(imported.projectId).toBe(project.id);
    expect(imported.labels[0]!.name).toBe("triage");
    expect((await getIssue(ctx, imported.id)).githubLink).toMatchObject({ number: 9 });
  });
});

describe("pull requests & checks", () => {
  const pr = (over: Record<string, unknown> = {}) => ({
    action: "opened",
    installation: { id: 77 },
    repository: { full_name: "acme/web" },
    pull_request: {
      number: 12,
      title: "Fix login",
      body: "Closes web-1",
      html_url: "https://github.com/acme/web/pull/12",
      state: "open",
      merged: false,
      merged_at: null,
      head: { ref: "web-1-fix-login", sha: "abc" },
      ...over,
    },
  });

  it("links PRs by key, tracks checks, and moves to DONE on merge", async () => {
    const { ctx } = await installedTeam();
    const { project, todo, done } = await makeProject(ctx, "Web", "WEB");
    const installation = await db.gitHubInstallation.findFirstOrThrow();
    await connectRepo(ctx, { installationId: installation.id, repoFullName: "acme/web", projectId: project.id, importIssues: "OFF" });
    const issue = await makeIssue(ctx, todo.id, "Login");

    await deliver("pull_request", pr());
    let card = await getIssue(ctx, issue.id);
    expect(card.pullRequests).toEqual([
      expect.objectContaining({ number: 12, state: "OPEN", checks: "NONE", repoFullName: "acme/web" }),
    ]);

    gh.state.checkSuites.abc = [
      { status: "completed", conclusion: "success" },
      { status: "queued", conclusion: null, latest_check_runs_count: 0 },
    ];
    await deliver("check_suite", { action: "completed", installation: { id: 77 }, repository: { full_name: "acme/web" }, check_suite: { head_sha: "abc" } });
    card = await getIssue(ctx, issue.id);
    expect(card.pullRequests![0]!.checks).toBe("PASS");

    // A new commit resets checks.
    await deliver("pull_request", pr({ head: { ref: "web-1-fix-login", sha: "def" } }));
    expect((await getIssue(ctx, issue.id)).pullRequests![0]!.checks).toBe("NONE");

    await deliver("pull_request", pr({ state: "closed", merged: true, merged_at: new Date().toISOString(), head: { ref: "web-1-fix-login", sha: "def" } }));
    card = await getIssue(ctx, issue.id);
    expect(card.pullRequests![0]!.state).toBe("MERGED");
    expect(card.column.id).toBe(done.id);
  });

  it("ignores PRs in repos not connected to this workspace", async () => {
    const { ctx } = await installedTeam();
    const { todo } = await makeProject(ctx, "Web", "WEB");
    const issue = await makeIssue(ctx, todo.id, "Login");
    await deliver("pull_request", pr());
    expect((await getIssue(ctx, issue.id)).pullRequests).toEqual([]);
  });

  it("move on merge off leaves the issue where it is", async () => {
    const { ctx } = await installedTeam();
    const { project, todo } = await makeProject(ctx, "Web", "WEB");
    const installation = await db.gitHubInstallation.findFirstOrThrow();
    await connectRepo(ctx, { installationId: installation.id, repoFullName: "acme/web", projectId: project.id, importIssues: "OFF", moveOnMerge: false });
    const issue = await makeIssue(ctx, todo.id, "Login");
    await deliver("pull_request", pr({ state: "closed", merged: true, merged_at: new Date().toISOString() }));
    expect((await getIssue(ctx, issue.id)).column.id).toBe(todo.id);
  });

  it("extracts keys and combines checks", () => {
    expect(extractIssueKeys("web-42-fix", "Fixes API-7 and WEB-42", null)).toEqual(["WEB-42", "API-7"]);
    expect(combineChecks([])).toBe("NONE");
    expect(combineChecks([{ status: "in_progress", conclusion: null }])).toBe("PENDING");
    expect(combineChecks([{ status: "completed", conclusion: "success" }, { status: "completed", conclusion: "failure" }])).toBe("FAIL");
    expect(combineChecks([{ status: "completed", conclusion: "neutral" }])).toBe("PASS");
    expect(branchName("WEB-42", "Fix the login redirect!")).toBe("web-42-fix-the-login-redirect");
  });
});

describe("sync cron", () => {
  it("needs the cron secret, then syncs every repo", async () => {
    const call = (auth?: string) =>
      cronGET(new Request("http://localhost/api/cron/github-sync", { headers: auth ? { authorization: auth } : {} }));
    process.env.CRON_SECRET = "cron-secret";
    try {
      expect((await call()).status).toBe(401);
      expect((await call("Bearer wrong")).status).toBe(401);
      const { ctx, installation } = await installedTeam();
      const { project } = await makeProject(ctx, "Web", "WEB");
      await connectRepo(ctx, { installationId: installation.id, repoFullName: "acme/web", projectId: project.id, importIssues: "OFF" });
      await flushDeferred();
      await db.projectRepo.updateMany({ data: { importIssues: "ALL" } });
      gh.state.issues["acme/web"] = [{ number: 1, title: "A", body: null, state: "open", assignees: [] }];
      const response = await call("Bearer cron-secret");
      expect(await response.json()).toEqual({ repos: 1, imported: 1, updated: 0, failed: 0 });
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});

describe("webhook endpoint", () => {
  it("rejects bad signatures and dedupes deliveries", async () => {
    const payload = { action: "suspend", installation: { id: 77 } };
    expect((await deliver("installation", payload, "wrong-secret")).response.status).toBe(401);

    await installedTeam();
    const body = JSON.stringify(payload);
    const request = () =>
      webhookPOST(
        new Request("http://localhost/api/github/webhooks", {
          method: "POST",
          body,
          headers: { "x-github-event": "installation", "x-github-delivery": "same", "x-hub-signature-256": `sha256=${hmacHex(WEBHOOK_SECRET, body)}` },
        }),
      );
    expect(await (await request()).json()).toEqual({ ok: true });
    expect(await (await request()).json()).toEqual({ duplicate: true });
    expect((await db.gitHubInstallation.findFirstOrThrow()).suspendedAt).not.toBeNull();
    expect((await deliver("star", {})).response.status).toBe(202);
  });

  it("installation deleted removes it", async () => {
    await installedTeam();
    await deliver("installation", { action: "deleted", installation: { id: 77 } });
    expect(await db.gitHubInstallation.count()).toBe(0);
  });
});
