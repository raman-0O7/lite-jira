import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createSubIssue, moveIssue, updateIssue } from "@/lib/services/issues";
import { createLabel } from "@/lib/services/labels";
import { searchIssues } from "@/lib/services/search";
import { addMember, makeOwner, makeUser } from "@/tests/factories";
import { expectStatus, makeIssue, makeProject } from "@/tests/helpers";

async function seed() {
  const owner = await makeOwner("Owner");
  const { ctx } = owner;
  const web = await makeProject(ctx, "Web app");
  const mob = await makeProject(ctx, "Mobile");
  const teammate = await makeUser("Teammate");
  await addMember(owner.workspace.id, teammate, "MEMBER");
  await db.user.update({ where: { id: teammate.id }, data: { email: "mate@example.test" } });

  const epic = await makeIssue(ctx, web.todo.id, "Auth epic", "EPIC");
  const bug = await makeIssue(ctx, web.todo.id, "Login page crashes", "BUG");
  const story = await makeIssue(ctx, web.doing.id, "Signup flow", "STORY");
  const done = await makeIssue(ctx, web.todo.id, "Old cleanup");
  const mobile = await makeIssue(ctx, mob.todo.id, "Push notifications");
  const sub = await createSubIssue(ctx, story.id, { title: "Email step" });

  const auth = await createLabel(ctx, web.project.id, { name: "Auth", color: "#ff0000" });
  await updateIssue(ctx, bug.id, {
    assigneeUserId: owner.user.id,
    priority: "URGENT",
    labelIds: [auth.id],
    epicId: epic.id,
    description: "Crash happens on Safari",
    dueDate: "2000-01-01",
  });
  await updateIssue(ctx, story.id, { assigneeUserId: teammate.id, epicId: epic.id });
  await moveIssue(ctx, { issueId: done.id, toColumnId: web.done.id, toPosition: 0 });
  return { ...owner, epic, bug, story, done, mobile, sub };
}

const keys = (issues: { key: string }[]) => issues.map((i) => i.key).sort();

describe("searchIssues", () => {
  it("filters by every term", async () => {
    const s = await seed();
    const q = (query: string) => searchIssues(s.ctx, query).then(keys);

    expect(await q("assignee:me")).toEqual([s.bug.key]);
    expect(await q("assignee:mate@example.test")).toEqual([s.story.key]);
    expect(await q("assignee:none project:MOB")).toEqual([s.mobile.key]);
    expect(await q("type:bug,story")).toEqual(keys([s.bug, s.story]));
    expect(await q("status:done")).toEqual([s.done.key]);
    expect(await q("is:open project:WEB type:task")).toEqual([]);
    expect(await q("priority:urgent")).toEqual([s.bug.key]);
    expect(await q("label:auth")).toEqual([s.bug.key]);
    expect(await q(`epic:${s.epic.key}`)).toEqual(keys([s.bug, s.story]));
    expect(await q(`parent:${s.story.key}`)).toEqual([s.sub.key]);
    expect(await q("due:overdue")).toEqual([s.bug.key]);
    expect(await q(s.mobile.key.toLowerCase())).toEqual([s.mobile.key]);
    expect(await q("safari")).toEqual([s.bug.key]);
    expect(await q('"signup flow"')).toEqual([s.story.key]);
  });

  it("returns cards with their project", async () => {
    const s = await seed();
    const [hit] = await searchIssues(s.ctx, s.bug.key);
    expect(hit).toMatchObject({ key: s.bug.key, type: "BUG", project: { key: "WEB", name: "Web app" } });
  });

  it("only searches the ctx workspace", async () => {
    await seed();
    const stranger = await makeOwner("Stranger");
    expect(await searchIssues(stranger.ctx, "")).toEqual([]);
  });

  it("turns syntax errors into 400s", async () => {
    const s = await seed();
    await expectStatus(searchIssues(s.ctx, "owner:me"), 400);
  });
});
