import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { listIssueActivity } from "@/lib/services/activity";
import { createAgent } from "@/lib/services/agents";
import { getIssue, moveIssue, updateIssue } from "@/lib/services/issues";
import {
  createSavedFilter,
  deleteSavedFilter,
  getSavedFilter,
  listSavedFilters,
  updateSavedFilter,
} from "@/lib/services/filters";
import { addIssueLink, listIssueLinks, removeIssueLink } from "@/lib/services/links";
import { getMyWork } from "@/lib/services/my-work";
import { searchIssues } from "@/lib/services/search";
import { getProjectDetail } from "@/lib/services/projects";

import { addMember, makeTeam, makeUser, shareProject } from "../factories";
import { expectStatus, makeIssue, makeProject } from "../helpers";

const keys = (cards: { key: string }[]) => cards.map((c) => c.key);

describe("issue links", () => {
  it("links read from both sides; blocked while a blocker is open; activity on both issues", async () => {
    const { ctx } = await makeTeam();
    const web = await makeProject(ctx, "Web", "WEB");
    const api = await makeProject(ctx, "Api", "API");
    const login = await makeIssue(ctx, web.todo.id, "Login page");
    const auth = await makeIssue(ctx, api.todo.id, "Auth endpoint");
    const dup = await makeIssue(ctx, web.todo.id, "Login form");

    // "WEB-1 is blocked by API-1", said from WEB-1.
    const link = await addIssueLink(ctx, login.id, { relation: "blocked_by", target: "API-1" });
    expect(link).toMatchObject({ relation: "blocked_by", issue: { key: "API-1" } });
    await addIssueLink(ctx, dup.id, { relation: "duplicates", target: login.id });

    expect((await listIssueLinks(ctx, login.id)).map((l) => `${l.relation} ${l.issue.key}`)).toEqual([
      "blocked_by API-1",
      "duplicated_by WEB-2",
    ]);
    expect((await listIssueLinks(ctx, auth.id)).map((l) => `${l.relation} ${l.issue.key}`)).toEqual(["blocks WEB-1"]);

    expect((await getIssue(ctx, login.id)).blockedBy).toEqual(["API-1"]);
    expect(keys(await searchIssues(ctx, "is:blocked"))).toEqual(["WEB-1"]);
    const board = await getProjectDetail(ctx, web.project.id);
    expect(board.columns[0]!.issues.find((i) => i.key === "WEB-1")!.blockedBy).toEqual(["API-1"]);

    // Done blockers don't block.
    await moveIssue(ctx, { issueId: auth.id, toColumnId: api.done.id, toPosition: 0 });
    expect((await getIssue(ctx, login.id)).blockedBy).toEqual([]);
    expect(await searchIssues(ctx, "is:blocked")).toEqual([]);

    const timeline = (await listIssueActivity(ctx, auth.id)).entries.filter((e) => e.action === "issue.linked");
    expect(timeline[0]!.data).toMatchObject({ relation: "blocks", key: "WEB-1" });

    await removeIssueLink(ctx, auth.id, link.id);
    expect(await listIssueLinks(ctx, login.id)).toHaveLength(1);
    expect((await listIssueActivity(ctx, login.id)).entries.map((e) => e.action)).toContain("issue.unlinked");
  });

  it("rejects self links, duplicates, and the reverse block; guests can't link", async () => {
    const { ctx, workspace } = await makeTeam();
    const web = await makeProject(ctx, "Web", "WEB");
    const a = await makeIssue(ctx, web.todo.id, "A");
    const b = await makeIssue(ctx, web.todo.id, "B");

    await expectStatus(addIssueLink(ctx, a.id, { relation: "relates", target: "WEB-1" }), 400);
    await expectStatus(addIssueLink(ctx, a.id, { relation: "relates", target: "WEB-99" }), 404);
    await addIssueLink(ctx, a.id, { relation: "blocks", target: "WEB-2" });
    await expectStatus(addIssueLink(ctx, a.id, { relation: "blocks", target: "WEB-2" }), 409);
    await expect(addIssueLink(ctx, b.id, { relation: "blocks", target: "WEB-1" })).rejects.toThrow("WEB-1 already blocks WEB-2");
    await addIssueLink(ctx, a.id, { relation: "relates", target: "WEB-2" });
    await expectStatus(addIssueLink(ctx, b.id, { relation: "relates", target: "WEB-1" }), 409);

    const guest = await addMember(workspace.id, await makeUser("Gil"), "GUEST");
    await expectStatus(addIssueLink(guest, a.id, { relation: "relates", target: "WEB-2" }), 403);
  });

  it("hides links to issues the viewer can't see", async () => {
    const { ctx, workspace } = await makeTeam();
    const web = await makeProject(ctx, "Web", "WEB");
    const secret = await makeProject(ctx, "Secret", "SEC");
    const a = await makeIssue(ctx, web.todo.id, "A");
    await makeIssue(ctx, secret.todo.id, "Hidden");
    await addIssueLink(ctx, a.id, { relation: "blocked_by", target: "SEC-1" });

    const guestUser = await makeUser("Gil");
    const guest = await addMember(workspace.id, guestUser, "GUEST");
    await shareProject(workspace.id, guestUser.id, web.project.id);
    expect(await listIssueLinks(guest, a.id)).toEqual([]);
  });
});

describe("saved filters", () => {
  it("personal and shared; owners edit; admins delete shared ones; results run as the viewer", async () => {
    const { ctx, workspace } = await makeTeam();
    const web = await makeProject(ctx, "Web", "WEB");
    const secret = await makeProject(ctx, "Secret", "SEC");
    await makeIssue(ctx, web.todo.id, "Visible bug", "BUG");
    await makeIssue(ctx, secret.todo.id, "Secret bug", "BUG");

    const mine = await createSavedFilter(ctx, { name: "My bugs", query: "type:bug is:open" });
    const shared = await createSavedFilter(ctx, { name: "All bugs", query: "type:bug", shared: true });
    await expectStatus(createSavedFilter(ctx, { name: "My bugs", query: "is:open" }), 409);
    await expect(createSavedFilter(ctx, { name: "Bad", query: "priority:urgnt" })).rejects.toMatchObject({
      issues: [{ message: expect.stringContaining('Unknown value "urgnt"') }],
    });

    const memberUser = await makeUser("Mo");
    const member = await addMember(workspace.id, memberUser, "MEMBER");
    expect((await listSavedFilters(member)).map((f) => f.name)).toEqual(["All bugs"]);
    await expectStatus(getSavedFilter(member, mine.id), 404);
    await expectStatus(updateSavedFilter(member, shared.id, { name: "Mine now" }), 403);
    await expectStatus(deleteSavedFilter(member, shared.id), 403);
    const own = await createSavedFilter(member, { name: "Mo's", query: "assignee:me" });
    expect((await listSavedFilters(member)).map((f) => f.name)).toEqual(["Mo's", "All bugs"]);
    await updateSavedFilter(member, own.id, { query: "assignee:me is:open", shared: true });

    // A guest saves personal filters but can't share; shared results are scoped to what they see.
    const guestUser = await makeUser("Gil");
    const guest = await addMember(workspace.id, guestUser, "GUEST");
    await shareProject(workspace.id, guestUser.id, web.project.id);
    await createSavedFilter(guest, { name: "Gil's", query: "is:open" });
    await expectStatus(createSavedFilter(guest, { name: "Loud", query: "is:open", shared: true }), 403);
    expect(keys(await searchIssues(guest, (await getSavedFilter(guest, shared.id)).query))).toEqual(["WEB-1"]);

    const admin = await addMember(workspace.id, await makeUser("Ann"), "ADMIN");
    await deleteSavedFilter(admin, own.id);
    await expectStatus(deleteSavedFilter(admin, mine.id), 404);
    await deleteSavedFilter(ctx, mine.id);
    expect((await listSavedFilters(ctx)).map((f) => f.name)).toEqual(["All bugs"]);
  });
});

describe("my work", () => {
  it("sections the caller's issues, most urgent first, each issue once", async () => {
    const { ctx, user, workspace } = await makeTeam();
    const web = await makeProject(ctx, "Web", "WEB");
    const api = await makeProject(ctx, "Api", "API");
    const me = { assigneeUserId: user.id };
    const low = await makeIssue(ctx, web.todo.id, "Low");
    const urgent = await makeIssue(ctx, api.todo.id, "Urgent");
    const overdue = await makeIssue(ctx, web.todo.id, "Overdue");
    const doing = await makeIssue(ctx, web.doing.id, "Doing");
    const reviewing = await makeIssue(ctx, web.doing.id, "Has a PR");
    const done = await makeIssue(ctx, web.done.id, "Shipped");
    await updateIssue(ctx, low.id, { ...me, priority: "LOW" });
    await updateIssue(ctx, urgent.id, { ...me, priority: "URGENT" });
    await updateIssue(ctx, overdue.id, { ...me, priority: "LOW", dueDate: new Date(Date.now() - 3 * 864e5) });
    await updateIssue(ctx, doing.id, me);
    await updateIssue(ctx, reviewing.id, me);
    await updateIssue(ctx, done.id, me);
    await db.pullRequestLink.create({
      data: {
        issueId: reviewing.id,
        repoFullName: "acme/web",
        number: 7,
        url: "https://github.com/acme/web/pull/7",
        title: "Fix",
        branch: "web-4-has-a-pr",
        state: "OPEN",
      },
    });

    // Someone else's issue I reported; and one assigned to them that I didn't.
    const mo = await makeUser("Mo");
    await addMember(workspace.id, mo, "MEMBER");
    const reported = await makeIssue(ctx, web.todo.id, "For Mo");
    await updateIssue(ctx, reported.id, { assigneeUserId: mo.id });

    const work = await getMyWork(ctx);
    // The PR moves WEB-4 to Needs you; overdue beats urgent; done this week; WEB-6 I reported.
    expect(keys(work.needsYou)).toEqual(["WEB-4"]);
    expect(keys(work.inProgress)).toEqual(["WEB-3"]);
    expect(keys(work.todo)).toEqual(["WEB-2", "API-1", "WEB-1"]);
    expect(keys(work.doneThisWeek)).toEqual(["WEB-5"]);
    expect(keys(work.created)).toContain("WEB-6");
  });

  it("needs you: your agent waiting for input, or the run's runner when someone else's connection claimed it", async () => {
    const { ctx, user, workspace } = await makeTeam();
    const web = await makeProject(ctx, "Web", "WEB");
    const { agent } = await createAgent(ctx, { kind: "MCP", name: "Bot", webhookUrl: null });
    const issue = await makeIssue(ctx, web.doing.id, "Waiting");
    await db.issue.update({ where: { id: issue.id }, data: { assigneeUserId: user.id, assigneeAgentId: agent.id } });
    const run = await db.agentRun.create({
      data: { workspaceId: workspace.id, issueId: issue.id, agentId: agent.id, status: "NEEDS_INPUT" },
    });
    expect(keys((await getMyWork(ctx)).needsYou)).toEqual(["WEB-1"]);

    const annUser = await makeUser("Ann");
    const ann = await addMember(workspace.id, annUser, "MEMBER");
    await db.agentRun.update({ where: { id: run.id }, data: { runnerUserId: annUser.id } });
    expect(keys((await getMyWork(ann)).needsYou)).toEqual(["WEB-1"]);
    // Still mine to track, but the session is Ann's to answer.
    const mine = await getMyWork(ctx);
    expect(keys(mine.needsYou)).toEqual([]);
    expect(keys(mine.inProgress)).toEqual(["WEB-1"]);
  });
});
