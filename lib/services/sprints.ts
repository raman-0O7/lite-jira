import type { ColumnCategory, IssueType, Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import type { Ctx } from "@/lib/services/context";
import { badRequest, notFound, ServiceError } from "@/lib/services/errors";
import { cardSelect, toCard } from "@/lib/services/issue-shapes";
import { projectScope } from "@/lib/services/scope";

/**
 * Sprints (docs/features/21-sprints.md): plan, start, complete, and the
 * burndown / velocity reports. Totals count the issues that are planned
 * work: epics group work and sub-issues travel with their parent, so neither
 * counts on its own.
 */

const DAY = 24 * 60 * 60 * 1000;
const COUNTED: Prisma.IssueWhereInput = { type: { notIn: ["EPIC", "SUBTASK"] }, archivedAt: null };

export const sprintSelect = {
  id: true,
  number: true,
  name: true,
  goal: true,
  state: true,
  startDate: true,
  endDate: true,
  startedAt: true,
  completedAt: true,
  committedIssues: true,
  committedPoints: true,
  completedIssues: true,
  completedPoints: true,
  createdAt: true,
} satisfies Prisma.SprintSelect;

const name = z.string().trim().min(1, "Name the sprint").max(80);
const goal = z.string().trim().max(500).nullish();
const date = z.coerce.date();

const createSchema = z.object({ name: name.optional(), goal });
const updateSchema = z
  .object({ name: name.optional(), goal, startDate: date.nullish(), endDate: date.nullish() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: "Nothing to update" });
const startSchema = z.object({ name: name.optional(), goal, startDate: date.optional(), endDate: date });
const completeSchema = z.object({
  // Where open issues go: the backlog, a new sprint, or a planned sprint's id.
  moveOpenTo: z.union([z.literal("backlog"), z.literal("new"), z.string().min(1)]).default("backlog"),
});

/** Serialize sprint changes per project (one active sprint, numbering). */
async function lockProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
}

async function findProject(client: Prisma.TransactionClient, ctx: Ctx, projectId: string) {
  const project = await client.project.findFirst({
    where: { AND: [{ id: projectId }, projectScope(ctx)] },
    select: { id: true, key: true, mode: true },
  });
  if (!project) throw notFound("Project not found");
  return project;
}

async function findSprint(client: Prisma.TransactionClient, ctx: Ctx, sprintId: string) {
  const sprint = await client.sprint.findFirst({
    where: { id: sprintId, project: projectScope(ctx) },
    select: { ...sprintSelect, projectId: true, project: { select: { key: true, mode: true } } },
  });
  if (!sprint) throw notFound("Sprint not found");
  return sprint;
}

type Totals = { issues: number; points: number; doneIssues: number; donePoints: number };

/** Issue and point totals for a sprint, and how much of each is done. */
async function totals(client: Prisma.TransactionClient, sprintId: string): Promise<Totals> {
  const rows = await client.issue.findMany({
    where: { sprintId, ...COUNTED },
    select: { estimate: true, column: { select: { category: true } } },
  });
  const done = rows.filter((r) => r.column.category === "DONE");
  const points = (list: typeof rows) => list.reduce((sum, r) => sum + (r.estimate ?? 0), 0);
  return { issues: rows.length, points: points(rows), doneIssues: done.length, donePoints: points(done) };
}

/**
 * The project's sprints: active, planned (in order), then the latest
 * completed ones. (`state desc` is enum order reversed: ACTIVE, PLANNED.)
 */
export async function listSprints(ctx: Ctx, projectId: string) {
  authorize(ctx, "project.read");
  const project = await findProject(db, ctx, projectId);
  const [open, closed] = await Promise.all([
    db.sprint.findMany({
      where: { projectId: project.id, state: { in: ["ACTIVE", "PLANNED"] } },
      orderBy: [{ state: "desc" }, { number: "asc" }],
      select: sprintSelect,
    }),
    db.sprint.findMany({
      where: { projectId: project.id, state: "CLOSED" },
      orderBy: { completedAt: "desc" },
      take: 20,
      select: sprintSelect,
    }),
  ]);
  const sprints = [...open, ...closed];
  const withTotals = await Promise.all(sprints.map(async (s) => ({ ...s, totals: await totals(db, s.id) })));
  return withTotals;
}

const backlogCardSelect = { ...cardSelect, column: { select: { name: true, category: true } } } satisfies Prisma.IssueSelect;

/** Highest priority first, then oldest. */
const backlogOrder: Prisma.IssueOrderByWithRelationInput[] = [{ priority: "desc" }, { createdAt: "asc" }];

/**
 * The backlog view: the active and planned sprints with their issues, then
 * open issues in no sprint.
 */
export async function getBacklog(ctx: Ctx, projectId: string) {
  authorize(ctx, "project.read");
  const project = await findProject(db, ctx, projectId);
  const sprints = await db.sprint.findMany({
    where: { projectId: project.id, state: { in: ["ACTIVE", "PLANNED"] } },
    orderBy: [{ state: "desc" }, { number: "asc" }],
    select: {
      ...sprintSelect,
      issues: { where: COUNTED, orderBy: backlogOrder, select: backlogCardSelect },
    },
  });
  const backlog = await db.issue.findMany({
    where: { projectId: project.id, sprintId: null, ...COUNTED, column: { category: { not: "DONE" } } },
    orderBy: backlogOrder,
    select: backlogCardSelect,
  });
  const card = (issue: (typeof backlog)[number]) => toCard(project.key, issue);
  return {
    mode: project.mode,
    sprints: sprints.map(({ issues, ...sprint }) => ({ ...sprint, issues: issues.map(card) })),
    backlog: backlog.map(card),
  };
}

export async function createSprint(ctx: Ctx, projectId: string, input: unknown) {
  authorize(ctx, "sprint.manage");
  const parsed = createSchema.parse(input ?? {});
  return db.$transaction(async (tx) => {
    const project = await findProject(tx, ctx, projectId);
    if (project.mode !== "SCRUM") throw badRequest("Turn on sprints for this project first");
    await lockProject(tx, project.id);
    const last = await tx.sprint.aggregate({ where: { projectId: project.id }, _max: { number: true } });
    const number = (last._max.number ?? 0) + 1;
    const sprint = await tx.sprint.create({
      data: {
        projectId: project.id,
        number,
        name: parsed.name ?? `${project.key} Sprint ${number}`,
        goal: parsed.goal || null,
      },
      select: sprintSelect,
    });
    await recordActivity(tx, ctx, {
      action: "sprint.created",
      projectId: project.id,
      data: { sprintId: sprint.id, name: sprint.name },
    });
    return sprint;
  });
}

export async function updateSprint(ctx: Ctx, sprintId: string, input: unknown) {
  authorize(ctx, "sprint.manage");
  const patch = updateSchema.parse(input);
  return db.$transaction(async (tx) => {
    const before = await findSprint(tx, ctx, sprintId);
    if (before.state === "CLOSED") throw badRequest("A completed sprint can't be changed");
    const start = patch.startDate !== undefined ? patch.startDate : before.startDate;
    const end = patch.endDate !== undefined ? patch.endDate : before.endDate;
    if (start && end && end <= start) throw badRequest("The end date must be after the start date");
    if (before.state === "ACTIVE" && (!start || !end)) throw badRequest("An active sprint needs both dates");
    const sprint = await tx.sprint.update({
      where: { id: sprintId },
      data: {
        name: patch.name,
        goal: patch.goal === undefined ? undefined : patch.goal || null,
        startDate: patch.startDate,
        endDate: patch.endDate,
      },
      select: sprintSelect,
    });
    await recordActivity(tx, ctx, {
      action: "sprint.updated",
      projectId: before.projectId,
      data: { sprintId, name: sprint.name },
    });
    return sprint;
  });
}

/** Planned sprints only; their issues go back to the backlog. */
export async function deleteSprint(ctx: Ctx, sprintId: string) {
  authorize(ctx, "sprint.manage");
  await db.$transaction(async (tx) => {
    const sprint = await findSprint(tx, ctx, sprintId);
    if (sprint.state !== "PLANNED") throw badRequest("Only a planned sprint can be deleted");
    await tx.issue.updateMany({ where: { sprintId }, data: { sprintId: null } });
    await tx.sprint.delete({ where: { id: sprintId } });
    await recordActivity(tx, ctx, {
      action: "sprint.deleted",
      projectId: sprint.projectId,
      data: { sprintId, name: sprint.name },
    });
  });
}

export async function startSprint(ctx: Ctx, sprintId: string, input: unknown) {
  authorize(ctx, "sprint.manage");
  const parsed = startSchema.parse(input);
  return db.$transaction(async (tx) => {
    const found = await findSprint(tx, ctx, sprintId);
    await lockProject(tx, found.projectId);
    // Re-read under the lock.
    const sprint = await findSprint(tx, ctx, sprintId);
    if (sprint.project.mode !== "SCRUM") throw badRequest("Turn on sprints for this project first");
    if (sprint.state !== "PLANNED") throw badRequest("Only a planned sprint can be started");
    const active = await tx.sprint.findFirst({
      where: { projectId: sprint.projectId, state: "ACTIVE" },
      select: { name: true },
    });
    if (active) throw new ServiceError(409, `${active.name} is still active. Complete it first.`);
    const startDate = parsed.startDate ?? new Date();
    if (parsed.endDate <= startDate) throw badRequest("The end date must be after the start date");
    const t = await totals(tx, sprintId);
    if (t.issues === 0) throw badRequest("Add issues to the sprint before starting it");

    const updated = await tx.sprint.update({
      where: { id: sprintId },
      data: {
        state: "ACTIVE",
        name: parsed.name,
        goal: parsed.goal === undefined ? undefined : parsed.goal || null,
        startDate,
        endDate: parsed.endDate,
        startedAt: new Date(),
        committedIssues: t.issues,
        committedPoints: t.points,
      },
      select: sprintSelect,
    });
    await recordActivity(tx, ctx, {
      action: "sprint.started",
      projectId: sprint.projectId,
      data: { sprintId, name: updated.name, issues: t.issues, points: t.points },
    });
    return updated;
  });
}

/**
 * Close the active sprint. Done issues stay; open ones (and their
 * sub-issues) move to the backlog, a new sprint, or a planned one.
 */
export async function completeSprint(ctx: Ctx, sprintId: string, input: unknown) {
  authorize(ctx, "sprint.manage");
  const { moveOpenTo } = completeSchema.parse(input ?? {});
  return db.$transaction(async (tx) => {
    const found = await findSprint(tx, ctx, sprintId);
    await lockProject(tx, found.projectId);
    const sprint = await findSprint(tx, ctx, sprintId);
    if (sprint.state !== "ACTIVE") throw badRequest("Only the active sprint can be completed");

    let target: { id: string; name: string } | null = null;
    if (moveOpenTo === "new") {
      const last = await tx.sprint.aggregate({ where: { projectId: sprint.projectId }, _max: { number: true } });
      const number = (last._max.number ?? 0) + 1;
      target = await tx.sprint.create({
        data: { projectId: sprint.projectId, number, name: `${sprint.project.key} Sprint ${number}` },
        select: { id: true, name: true },
      });
      await recordActivity(tx, ctx, {
        action: "sprint.created",
        projectId: sprint.projectId,
        data: { sprintId: target.id, name: target.name },
      });
    } else if (moveOpenTo !== "backlog") {
      target = await tx.sprint.findFirst({
        where: { id: moveOpenTo, projectId: sprint.projectId, state: "PLANNED" },
        select: { id: true, name: true },
      });
      if (!target) throw badRequest("Pick a planned sprint in this project");
    }

    const t = await totals(tx, sprintId);
    const open = await tx.issue.findMany({
      where: { sprintId, type: { not: "SUBTASK" }, column: { category: { not: "DONE" } } },
      select: { id: true },
    });
    const ids = open.map((i) => i.id);
    const to = target?.id ?? null;
    await tx.issue.updateMany({ where: { OR: [{ id: { in: ids } }, { parentId: { in: ids } }] }, data: { sprintId: to } });
    // Each move goes in the issue's history (and keeps the burndown replayable).
    for (const issueId of ids) {
      await recordActivity(tx, ctx, {
        action: "issue.updated",
        projectId: sprint.projectId,
        issueId,
        // Marked so the burndown reads the sprint as it stood when it ended.
        data: { changes: { sprintId: { from: sprintId, to } }, sprintCompleted: sprintId },
      });
    }

    const updated = await tx.sprint.update({
      where: { id: sprintId },
      data: { state: "CLOSED", completedAt: new Date(), completedIssues: t.doneIssues, completedPoints: t.donePoints },
      select: sprintSelect,
    });
    await recordActivity(tx, ctx, {
      action: "sprint.completed",
      projectId: sprint.projectId,
      data: {
        sprintId,
        name: updated.name,
        doneIssues: t.doneIssues,
        donePoints: t.donePoints,
        moved: ids.length,
        movedTo: target ? { sprintId: target.id, name: target.name } : "backlog",
      },
    });
    return { sprint: updated, moved: ids.length, movedTo: target };
  });
}

// ---------------------------------------------------------------- reports

type Unit = "points" | "issues";

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

type Change = { from: unknown; to: unknown };
type IssueState = {
  type: IssueType;
  sprintId: string | null;
  category: ColumnCategory;
  estimate: number | null;
  exists: boolean;
};

/**
 * Remaining work per day, rebuilt from history: start from each issue's
 * current state and undo its moves, estimate and sprint changes newest
 * first, reading the totals at the end of each day.
 */
export async function getBurndown(ctx: Ctx, sprintId: string, now = new Date()) {
  authorize(ctx, "project.read");
  const sprint = await findSprint(db, ctx, sprintId);
  if (!sprint.startDate || !sprint.endDate || sprint.state === "PLANNED") {
    throw badRequest("The sprint hasn't started");
  }

  // Every issue that is, or ever was, in the sprint.
  const moved = await db.activity.findMany({
    where: {
      projectId: sprint.projectId,
      action: "issue.updated",
      OR: [
        { data: { path: ["changes", "sprintId", "to"], equals: sprintId } },
        { data: { path: ["changes", "sprintId", "from"], equals: sprintId } },
      ],
    },
    select: { issueId: true },
  });
  const issues = await db.issue.findMany({
    where: {
      projectId: sprint.projectId,
      OR: [{ sprintId }, { id: { in: moved.flatMap((m) => (m.issueId ? [m.issueId] : [])) } }],
    },
    select: {
      id: true,
      type: true,
      sprintId: true,
      estimate: true,
      archivedAt: true,
      createdAt: true,
      column: { select: { category: true } },
    },
  });
  const columns = new Map(
    (await db.column.findMany({ where: { projectId: sprint.projectId }, select: { id: true, category: true } })).map(
      (c) => [c.id, c.category],
    ),
  );
  const firstDay = startOfDay(sprint.startDate);
  const events = await db.activity.findMany({
    where: {
      issueId: { in: issues.map((i) => i.id) },
      action: { in: ["issue.moved", "issue.updated"] },
      createdAt: { gte: new Date(firstDay) },
    },
    orderBy: { createdAt: "desc" },
    select: { issueId: true, action: true, data: true, createdAt: true },
  });

  const state = new Map<string, IssueState & { createdAt: number; archivedAt: number | null }>(
    issues.map((i) => [
      i.id,
      {
        type: i.type,
        sprintId: i.sprintId,
        category: i.column.category,
        estimate: i.estimate,
        exists: true,
        createdAt: i.createdAt.getTime(),
        archivedAt: i.archivedAt?.getTime() ?? null,
      },
    ]),
  );
  const unit: Unit =
    (sprint.committedPoints ?? 0) > 0 || issues.some((i) => (i.estimate ?? 0) > 0) ? "points" : "issues";
  const weight = (s: IssueState) => (unit === "points" ? (s.estimate ?? 0) : 1);

  const lastDay = startOfDay(sprint.endDate);
  const until = Math.min((sprint.completedAt ?? now).getTime(), now.getTime());
  const days: { date: string; remaining: number | null; scope: number | null }[] = [];
  for (let d = firstDay; d <= lastDay; d += DAY) days.push({ date: dayKey(d), remaining: null, scope: null });

  // Walk days newest first, undoing events that happened after each day's end.
  // Completing the sprint moves its open issues out; those moves count as
  // after the end, so the last day shows the work left when it ended.
  const happenedAt = (event: (typeof events)[number]) =>
    (event.data as { sprintCompleted?: string } | null)?.sprintCompleted === sprintId
      ? Number.POSITIVE_INFINITY
      : event.createdAt.getTime();
  let cursor = 0;
  for (let index = days.length - 1; index >= 0; index--) {
    const dayStart = firstDay + index * DAY;
    if (dayStart > until) continue;
    const end = Math.min(dayStart + DAY - 1, until);
    while (cursor < events.length && happenedAt(events[cursor]!) > end) {
      const event = events[cursor++]!;
      const s = event.issueId ? state.get(event.issueId) : undefined;
      if (!s) continue;
      const data = (event.data ?? {}) as { fromColumnId?: string; changes?: Record<string, Change> };
      if (event.action === "issue.moved" && data.fromColumnId) {
        s.category = columns.get(data.fromColumnId) ?? "TODO";
      } else if (event.action === "issue.updated" && data.changes) {
        if (data.changes.sprintId) s.sprintId = (data.changes.sprintId.from as string | null) ?? null;
        if (data.changes.estimate) s.estimate = (data.changes.estimate.from as number | null) ?? null;
      }
    }
    let remaining = 0;
    let scope = 0;
    for (const s of state.values()) {
      if (s.createdAt > end || (s.archivedAt !== null && s.archivedAt <= end)) continue;
      if (s.sprintId !== sprintId || s.type === "EPIC" || s.type === "SUBTASK") continue;
      scope += weight(s);
      if (s.category !== "DONE") remaining += weight(s);
    }
    days[index] = { ...days[index]!, remaining, scope };
  }

  return {
    sprint: { id: sprint.id, name: sprint.name, state: sprint.state, startDate: sprint.startDate, endDate: sprint.endDate },
    unit,
    committed: unit === "points" ? (sprint.committedPoints ?? 0) : (sprint.committedIssues ?? 0),
    days,
  };
}

/** Committed vs completed for the last seven completed sprints. */
export async function getVelocity(ctx: Ctx, projectId: string) {
  authorize(ctx, "project.read");
  const project = await findProject(db, ctx, projectId);
  const closed = (
    await db.sprint.findMany({
      where: { projectId: project.id, state: "CLOSED" },
      orderBy: { completedAt: "desc" },
      take: 7,
      select: sprintSelect,
    })
  ).reverse();
  const unit: Unit = closed.some((s) => (s.committedPoints ?? 0) > 0) ? "points" : "issues";
  const sprints = closed.map((s) => ({
    id: s.id,
    name: s.name,
    committed: (unit === "points" ? s.committedPoints : s.committedIssues) ?? 0,
    completed: (unit === "points" ? s.completedPoints : s.completedIssues) ?? 0,
  }));
  const average = sprints.length ? Math.round(sprints.reduce((n, s) => n + s.completed, 0) / sprints.length) : null;
  return { unit, sprints, average };
}
