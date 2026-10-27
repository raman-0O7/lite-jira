import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { reorderColumns, updateColumn } from "@/lib/services/columns";
import type { Ctx } from "@/lib/services/context";
import {
  createIssue,
  createSubIssue,
  deleteIssue,
  getIssue,
  getIssueByKey,
  moveIssue,
  updateIssue,
} from "@/lib/services/issues";
import { createLabel } from "@/lib/services/labels";
import { getProjectDetail } from "@/lib/services/projects";
import { addMember, makeOwner, makeUser } from "@/tests/factories";
import { columnTitles, expectStatus, makeIssue, makeProject } from "@/tests/helpers";

describe("issue keys", () => {
  it("numbers issues per project, sequentially, and never reuses a number", async () => {
    const { ctx } = await makeOwner();
    const web = await makeProject(ctx, "Web app");
    const mob = await makeProject(ctx, "Mobile");

    const a = await makeIssue(ctx, web.todo.id, "a");
    const b = await makeIssue(ctx, web.todo.id, "b");
    const m = await makeIssue(ctx, mob.todo.id, "m");
    expect([a.key, b.key, m.key]).toEqual(["WEB-1", "WEB-2", "MOB-1"]);

    await deleteIssue(ctx, b.id);
    const c = await makeIssue(ctx, web.todo.id, "c");
    expect(c.key).toBe("WEB-3");
  });

  it("hands out unique numbers under concurrent creates", async () => {
    const { ctx } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const issues = await Promise.all(
      Array.from({ length: 8 }, (_, i) => makeIssue(ctx, todo.id, `issue ${i}`)),
    );
    expect(new Set(issues.map((i) => i.number)).size).toBe(8);
    expect(Math.max(...issues.map((i) => i.number))).toBe(8);
  });

  it("finds an issue by key, case-insensitively, only in its workspace", async () => {
    const alice = await makeOwner("Alice");
    const bob = await makeOwner("Bob");
    const { todo } = await makeProject(alice.ctx);
    const issue = await makeIssue(alice.ctx, todo.id, "find me");

    expect((await getIssueByKey(alice.ctx, "web-1")).id).toBe(issue.id);
    await expectStatus(getIssueByKey(bob.ctx, "WEB-1"), 404);
    await expectStatus(getIssueByKey(alice.ctx, "not a key"), 404);
  });

  it("records the reporter", async () => {
    const { ctx, user } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const issue = await makeIssue(ctx, todo.id);
    expect((await getIssue(ctx, issue.id)).reporter?.id).toBe(user.id);
  });
});

describe("sub-issues", () => {
  async function setup() {
    const owner = await makeOwner();
    const p = await makeProject(owner.ctx);
    const parent = await makeIssue(owner.ctx, p.doing.id, "Parent", "STORY");
    return { ...owner, ...p, parent };
  }

  it("are SUBTASKs in the first TODO column and show up on the parent", async () => {
    const { ctx, todo, parent } = await setup();
    const sub = await createSubIssue(ctx, parent.id, { title: "Child" });
    expect(sub).toMatchObject({ type: "SUBTASK", key: "WEB-2", columnId: todo.id, parentId: parent.id });

    const full = await getIssue(ctx, parent.id);
    expect(full.subIssues.map((s) => s.key)).toEqual(["WEB-2"]);
    expect(full).toMatchObject({ subIssueCount: 1, subIssueDoneCount: 0 });
  });

  it("count as done when they sit in a DONE column", async () => {
    const { ctx, project, parent, done } = await setup();
    const sub = await createSubIssue(ctx, parent.id, { title: "Child" });
    await moveIssue(ctx, { issueId: sub.id, toColumnId: done.id, toPosition: 0 });
    const card = (await getProjectDetail(ctx, project.id)).columns
      .flatMap((c) => c.issues)
      .find((i) => i.id === parent.id);
    expect(card).toMatchObject({ subIssueCount: 1, subIssueDoneCount: 1 });
  });

  it("can't nest, and epics can't have them", async () => {
    const { ctx, todo, parent } = await setup();
    const sub = await createSubIssue(ctx, parent.id, { title: "Child" });
    await expectStatus(createSubIssue(ctx, sub.id, { title: "Grandchild" }), 400);
    const epic = await makeIssue(ctx, todo.id, "Epic", "EPIC");
    await expectStatus(createSubIssue(ctx, epic.id, { title: "Nope" }), 400);
  });

  it("can't change type, and nothing becomes one", async () => {
    const { ctx, parent } = await setup();
    const sub = await createSubIssue(ctx, parent.id, { title: "Child" });
    await expectStatus(updateIssue(ctx, sub.id, { type: "TASK" }), 400);
    await expectStatus(updateIssue(ctx, parent.id, { type: "SUBTASK" }), 400);
  });

  it("are deleted with their parent", async () => {
    const { ctx, parent } = await setup();
    await createSubIssue(ctx, parent.id, { title: "Child" });
    await deleteIssue(ctx, parent.id);
    expect(await db.issue.count()).toBe(0);
  });
});

describe("epics", () => {
  async function setup() {
    const owner = await makeOwner();
    const p = await makeProject(owner.ctx);
    const epic = await makeIssue(owner.ctx, p.todo.id, "Epic", "EPIC");
    const story = await makeIssue(owner.ctx, p.todo.id, "Story", "STORY");
    return { ...owner, ...p, epic, story };
  }

  it("group issues in the same project", async () => {
    const { ctx, epic, story } = await setup();
    const updated = await updateIssue(ctx, story.id, { epicId: epic.id });
    expect(updated.epic).toMatchObject({ id: epic.id, key: "WEB-1" });
  });

  it("must be an EPIC in the same project", async () => {
    const { ctx, story } = await setup();
    const other = await makeProject(ctx, "Mobile");
    const foreignEpic = await makeIssue(ctx, other.todo.id, "Other epic", "EPIC");
    const notEpic = await makeIssue(ctx, other.todo.id, "Task");
    await expectStatus(updateIssue(ctx, story.id, { epicId: foreignEpic.id }), 400);
    await expectStatus(updateIssue(ctx, story.id, { epicId: notEpic.id }), 400);
  });

  it("can't contain epics or sub-issues", async () => {
    const { ctx, epic, todo, story } = await setup();
    const epic2 = await makeIssue(ctx, todo.id, "Epic 2", "EPIC");
    await expectStatus(updateIssue(ctx, epic2.id, { epicId: epic.id }), 400);
    const sub = await createSubIssue(ctx, story.id, { title: "Child" });
    await expectStatus(updateIssue(ctx, sub.id, { epicId: epic.id }), 400);
  });

  it("can't change type while they still hold issues, and detach on delete", async () => {
    const { ctx, epic, story } = await setup();
    await updateIssue(ctx, story.id, { epicId: epic.id });
    await expectStatus(updateIssue(ctx, epic.id, { type: "STORY" }), 400);
    await deleteIssue(ctx, epic.id);
    expect((await getIssue(ctx, story.id)).epicId).toBeNull();
  });
});

describe("assignees", () => {
  it("must be non-guest members of the workspace", async () => {
    const { ctx, workspace } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const issue = await makeIssue(ctx, todo.id);
    const member = await makeUser("Member");
    await addMember(workspace.id, member, "MEMBER");
    const guest = await makeUser("Guest");
    await addMember(workspace.id, guest, "GUEST");
    const stranger = await makeUser("Stranger");

    const updated = await updateIssue(ctx, issue.id, { assigneeUserId: member.id });
    expect(updated.assignee).toMatchObject({ id: member.id, name: "Member" });
    await expectStatus(updateIssue(ctx, issue.id, { assigneeUserId: guest.id }), 400);
    await expectStatus(updateIssue(ctx, issue.id, { assigneeUserId: stranger.id }), 400);
    expect((await updateIssue(ctx, issue.id, { assigneeUserId: null })).assignee).toBeNull();
  });
});

describe("createIssue", () => {
  it("takes priority, description, and a member assignee from the new-issue dialog", async () => {
    const { ctx, workspace } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const member = await makeUser("Member");
    await addMember(workspace.id, member, "MEMBER");

    const card = await createIssue(ctx, todo.id, {
      title: "Ship it",
      type: "BUG",
      priority: "HIGH",
      description: "Steps to reproduce",
      assigneeUserId: member.id,
    });
    expect(card).toMatchObject({ type: "BUG", priority: "HIGH", assignee: { id: member.id } });
    const full = await getIssue(ctx, card.id);
    expect(full.description).toBe("Steps to reproduce");
    const activity = await db.activity.findFirstOrThrow({ where: { issueId: card.id, action: "issue.created" } });
    expect(activity.data).toMatchObject({ assigneeUserId: member.id });
  });

  it("defaults to medium priority, no description, and nobody assigned", async () => {
    const { ctx } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const card = await createIssue(ctx, todo.id, { title: "Plain", description: "" });
    expect(card).toMatchObject({ priority: "MEDIUM", assignee: null });
    expect((await getIssue(ctx, card.id)).description).toBeNull();
  });

  it("refuses guests and strangers as assignees", async () => {
    const { ctx, workspace } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const guest = await makeUser("Guest");
    await addMember(workspace.id, guest, "GUEST");
    const stranger = await makeUser("Stranger");

    await expectStatus(createIssue(ctx, todo.id, { title: "x", assigneeUserId: guest.id }), 400);
    await expectStatus(createIssue(ctx, todo.id, { title: "x", assigneeUserId: stranger.id }), 400);
    expect(await db.issue.count()).toBe(0);
  });
});

describe("updateIssue", () => {
  it("records only the fields that changed", async () => {
    const { ctx } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const issue = await makeIssue(ctx, todo.id, "Write tests");

    await updateIssue(ctx, issue.id, {
      title: "Write tests",
      priority: "HIGH",
      estimate: 3,
      acceptanceCriteria: "- [ ] green",
    });
    const updates = await db.activity.findMany({ where: { action: "issue.updated" } });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data).toMatchObject({
      changes: {
        priority: { from: "MEDIUM", to: "HIGH" },
        estimate: { from: null, to: 3 },
        acceptanceCriteria: true,
      },
    });
    expect((updates[0]?.data as { changes: object }).changes).not.toHaveProperty("title");
  });

  it("validates estimates", async () => {
    const { ctx } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const issue = await makeIssue(ctx, todo.id);
    for (const estimate of [-1, 101, 2.5]) {
      await expect(updateIssue(ctx, issue.id, { estimate })).rejects.toThrow();
    }
  });

  it("rejects labels from another project and leaves the issue untouched", async () => {
    const { ctx } = await makeOwner();
    const a = await makeProject(ctx, "Alpha");
    const b = await makeProject(ctx, "Beta");
    const foreign = await createLabel(ctx, b.project.id, { name: "bug", color: "#ff0000" });
    const issue = await makeIssue(ctx, a.todo.id, "Issue");

    await expectStatus(updateIssue(ctx, issue.id, { title: "Renamed", labelIds: [foreign.id] }), 404);
    expect((await getIssue(ctx, issue.id)).title).toBe("Issue");
  });

  it("is not allowed for guests", async () => {
    const { ctx, workspace } = await makeOwner();
    const { todo } = await makeProject(ctx);
    const issue = await makeIssue(ctx, todo.id);
    const guest: Ctx = await addMember(workspace.id, await makeUser("G"), "GUEST");
    await expectStatus(updateIssue(guest, issue.id, { title: "Hijack" }), 403);
  });
});

describe("moveIssue", () => {
  it("reindexes both columns on a cross-column move and records the category", async () => {
    const { ctx } = await makeOwner();
    const { project, todo, done } = await makeProject(ctx);
    const a = await makeIssue(ctx, todo.id, "a");
    await makeIssue(ctx, todo.id, "b");
    await makeIssue(ctx, done.id, "x");

    await moveIssue(ctx, { issueId: a.id, toColumnId: done.id, toPosition: 0 });
    const [todoIssues, , doneIssues] = await columnTitles(ctx, project.id);
    expect(todoIssues).toEqual(["0:b"]);
    expect(doneIssues).toEqual(["0:a", "1:x"]);
    const move = await db.activity.findFirstOrThrow({ where: { action: "issue.moved" } });
    expect(move.data).toMatchObject({ toColumnId: done.id, toCategory: "DONE" });
  });

  it("refuses to move an issue to another project", async () => {
    const { ctx } = await makeOwner();
    const a = await makeProject(ctx, "Alpha");
    const b = await makeProject(ctx, "Beta");
    const issue = await makeIssue(ctx, a.todo.id);
    await expectStatus(moveIssue(ctx, { issueId: issue.id, toColumnId: b.todo.id, toPosition: 0 }), 400);
  });
});

describe("columns", () => {
  it("can be recategorized", async () => {
    const { ctx } = await makeOwner();
    const { doing } = await makeProject(ctx);
    expect((await updateColumn(ctx, doing.id, { category: "DONE" })).category).toBe("DONE");
  });

  it("reorder rejects duplicated or missing ids", async () => {
    const { ctx } = await makeOwner();
    const { project, todo, doing, done } = await makeProject(ctx);
    for (const orderedIds of [
      [todo.id, doing.id],
      [todo.id, doing.id, done.id, done.id],
      [todo.id, doing.id, "nope"],
    ]) {
      await expectStatus(reorderColumns(ctx, { projectId: project.id, orderedIds }), 400);
    }
  });
});
