import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createSubIssue, getIssue, moveIssue, updateIssue } from "@/lib/services/issues";
import { getProjectDetail, updateProject } from "@/lib/services/projects";
import { searchIssues } from "@/lib/services/search";
import {
  completeSprint,
  createSprint,
  deleteSprint,
  getBacklog,
  getBurndown,
  getVelocity,
  listSprints,
  startSprint,
  updateSprint,
} from "@/lib/services/sprints";

import { addMember, makeTeam, makeUser } from "../factories";
import { expectStatus, makeIssue, makeProject } from "../helpers";

const DAY = 24 * 60 * 60 * 1000;
const keys = (cards: { key: string }[]) => cards.map((c) => c.key);
const inDays = (n: number) => new Date(Date.now() + n * DAY);

async function scrumProject() {
  const team = await makeTeam();
  const web = await makeProject(team.ctx, "Web", "WEB");
  await updateProject(team.ctx, web.project.id, { mode: "SCRUM" });
  return { ...team, web };
}

describe("sprints", () => {
  it("plan, start, complete: one active sprint, open issues carry over, velocity", async () => {
    const { ctx, workspace, web } = await scrumProject();
    const a = await makeIssue(ctx, web.todo.id, "A");
    const b = await makeIssue(ctx, web.todo.id, "B");
    const c = await makeIssue(ctx, web.todo.id, "C");
    const epic = await makeIssue(ctx, web.todo.id, "Epic", "EPIC");

    const s1 = await createSprint(ctx, web.project.id, {});
    const s2 = await createSprint(ctx, web.project.id, { name: "Polish", goal: "Ship it" });
    expect([s1.name, s2.name]).toEqual(["WEB Sprint 1", "Polish"]);
    await expectStatus(startSprint(ctx, s1.id, { endDate: inDays(14) }), 400); // empty

    await updateIssue(ctx, a.id, { sprintId: s1.id, estimate: 3 });
    await updateIssue(ctx, b.id, { sprintId: s1.id, estimate: 5 });
    await updateIssue(ctx, c.id, { estimate: 2 });
    await expectStatus(updateIssue(ctx, epic.id, { sprintId: s1.id }), 400);
    // Sub-issues follow their parent, now and when it moves.
    const sub = await createSubIssue(ctx, b.id, { title: "B.1" });
    expect(sub.sprintId).toBe(s1.id);
    await expectStatus(updateIssue(ctx, sub.id, { sprintId: null }), 400);

    const backlog = await getBacklog(ctx, web.project.id);
    expect(backlog.sprints.map((s) => [s.name, keys(s.issues)])).toEqual([
      ["WEB Sprint 1", ["WEB-1", "WEB-2"]],
      ["Polish", []],
    ]);
    expect(keys(backlog.backlog)).toEqual(["WEB-3"]); // epics and sub-issues aren't rows

    const started = await startSprint(ctx, s1.id, { endDate: inDays(14), goal: "Login" });
    expect(started).toMatchObject({ state: "ACTIVE", committedIssues: 2, committedPoints: 8, goal: "Login" });
    await updateIssue(ctx, c.id, { sprintId: s2.id });
    await expectStatus(startSprint(ctx, s2.id, { endDate: inDays(14) }), 409);
    await expectStatus(deleteSprint(ctx, s1.id), 400);
    await expectStatus(updateProject(ctx, web.project.id, { mode: "KANBAN" }), 400);
    expect((await getProjectDetail(ctx, web.project.id)).activeSprint).toMatchObject({ id: s1.id, goal: "Login" });

    expect(keys(await searchIssues(ctx, "sprint:active"))).toEqual(expect.arrayContaining(["WEB-1", "WEB-2", "WEB-5"]));
    expect(keys(await searchIssues(ctx, 'sprint:"polish"'))).toEqual(["WEB-3"]);
    expect(keys(await searchIssues(ctx, "sprint:none"))).toEqual(["WEB-4"]);

    // A done, B open: B (and its sub-issue) carry over to Polish.
    await moveIssue(ctx, { issueId: a.id, toColumnId: web.done.id, toPosition: 0 });
    const done = await completeSprint(ctx, s1.id, { moveOpenTo: s2.id });
    expect(done).toMatchObject({ moved: 1, movedTo: { id: s2.id }, sprint: { state: "CLOSED", completedIssues: 1, completedPoints: 3 } });
    expect((await getIssue(ctx, b.id)).sprint).toMatchObject({ id: s2.id });
    expect((await getIssue(ctx, sub.id)).sprintId).toBe(s2.id);
    expect((await getIssue(ctx, a.id)).sprintId).toBe(s1.id);
    await expectStatus(updateIssue(ctx, c.id, { sprintId: s1.id }), 400); // completed sprint
    await expectStatus(updateSprint(ctx, s1.id, { name: "x" }), 400);

    expect((await listSprints(ctx, web.project.id)).map((s) => `${s.name}:${s.state}`)).toEqual([
      "Polish:PLANNED",
      "WEB Sprint 1:CLOSED",
    ]);
    expect(await getVelocity(ctx, web.project.id)).toEqual({
      unit: "points",
      sprints: [{ id: s1.id, name: "WEB Sprint 1", committed: 8, completed: 3 }],
      average: 3,
    });

    // "new" makes the next sprint.
    await startSprint(ctx, s2.id, { endDate: inDays(7) });
    const next = await completeSprint(ctx, s2.id, { moveOpenTo: "new" });
    expect(next.movedTo).toMatchObject({ name: "WEB Sprint 3" });
    expect((await getIssue(ctx, c.id)).sprint).toMatchObject({ name: "WEB Sprint 3" });

    await updateProject(ctx, web.project.id, { mode: "KANBAN" });
    await expectStatus(createSprint(ctx, web.project.id, {}), 400);

    // Members plan sprints; guests and tokens don't.
    const guest = await addMember(workspace.id, await makeUser("Gil"), "GUEST");
    await expectStatus(createSprint(guest, web.project.id, {}), 403);
    const token = { ...ctx, via: "api_token" as const, limits: { write: true, projectIds: null } };
    await expectStatus(createSprint(token, web.project.id, {}), 403);
  });

  it("rebuilds the burndown from history", async () => {
    const { ctx, web } = await scrumProject();
    const sprint = await createSprint(ctx, web.project.id, {});
    const [a, b, c, d] = await Promise.all(["A", "B", "C", "D"].map((t) => makeIssue(ctx, web.todo.id, t)));
    await updateIssue(ctx, a!.id, { sprintId: sprint.id, estimate: 3 });
    await updateIssue(ctx, b!.id, { sprintId: sprint.id, estimate: 5 });
    await updateIssue(ctx, c!.id, { sprintId: sprint.id, estimate: 2 });
    await updateIssue(ctx, d!.id, { estimate: 1 });
    const ids = [a!.id, b!.id, c!.id, d!.id];

    // Everything so far happened four days ago; the sprint started three days ago.
    const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
    const at = (day: number) => new Date(today - (3 - day) * DAY + 12 * 60 * 60 * 1000); // noon on sprint day n
    await db.issue.updateMany({ where: { id: { in: ids } }, data: { createdAt: at(-1) } });
    await db.activity.updateMany({ where: { issueId: { in: ids } }, data: { createdAt: at(-1) } });
    await startSprint(ctx, sprint.id, { startDate: new Date(today - 3 * DAY), endDate: new Date(today + 4 * DAY) });

    const since = new Date();
    const stamp = async (day: number) =>
      db.activity.updateMany({ where: { issueId: { in: ids }, createdAt: { gte: since } }, data: { createdAt: at(day) } });
    await moveIssue(ctx, { issueId: a!.id, toColumnId: web.done.id, toPosition: 0 });
    await stamp(1); // day 1: A done
    await updateIssue(ctx, d!.id, { sprintId: sprint.id });
    await updateIssue(ctx, b!.id, { estimate: 8 });
    await stamp(2); // day 2: D added, B re-estimated
    await moveIssue(ctx, { issueId: b!.id, toColumnId: web.done.id, toPosition: 0 }); // today

    const burndown = await getBurndown(ctx, sprint.id);
    expect(burndown.unit).toBe("points");
    expect(burndown.committed).toBe(10);
    expect(burndown.days.map((d) => [d.remaining, d.scope])).toEqual([
      [10, 10],
      [7, 10],
      [11, 14],
      [3, 14],
      [null, null],
      [null, null],
      [null, null],
      [null, null],
    ]);

    // Completing it moves C and D out, but the last day still shows what was left.
    await completeSprint(ctx, sprint.id, { moveOpenTo: "backlog" });
    const closed = await getBurndown(ctx, sprint.id);
    expect(closed.days.slice(0, 4).map((d) => [d.remaining, d.scope])).toEqual([
      [10, 10],
      [7, 10],
      [11, 14],
      [3, 14],
    ]);
  });
});
