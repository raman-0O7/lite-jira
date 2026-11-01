import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { forbidden } from "@/lib/services/errors";
import { crossCardSelect, toCrossCard, visibleIssues } from "@/lib/services/search";

/**
 * My Work (docs/features/22-my-work.md §1): the caller's issues across
 * projects, in sections, most urgent first. An issue shows once, in the first
 * section it qualifies for.
 */

const SECTION_LIMIT = 100;
const DAY = 24 * 60 * 60 * 1000;
const PRIORITY_RANK = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

type Card = ReturnType<typeof toCrossCard>;

/** Overdue first, then priority, then due date, then last updated. */
export function byUrgency(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const overdue = (c: Card) => c.column.category !== "DONE" && c.dueDate !== null && c.dueDate.getTime() < today;
  return (a: Card, b: Card) =>
    Number(overdue(b)) - Number(overdue(a)) ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity) ||
    b.updatedAt.getTime() - a.updatedAt.getTime();
}

export async function getMyWork(ctx: Ctx, now = new Date()) {
  authorize(ctx, "project.read");
  const me = actingUserId(ctx);
  if (!me) throw forbidden();
  const visible = visibleIssues(ctx);
  const open: Prisma.IssueWhereInput = { column: { category: { not: "DONE" } } };
  const find = (where: Prisma.IssueWhereInput, take = SECTION_LIMIT) =>
    db.issue
      .findMany({ where: { AND: [visible, where] }, orderBy: { updatedAt: "desc" }, take, select: crossCardSelect })
      .then((rows) => rows.map(toCrossCard));

  const [waiting, assigned, done, created] = await Promise.all([
    find({
      OR: [
        // Your agent is waiting on you: you own it and nobody else claimed the run, or you're its runner.
        {
          agentRuns: {
            some: {
              status: "NEEDS_INPUT",
              OR: [{ runnerUserId: me }, { runnerUserId: null, agent: { ownerUserId: me } }],
            },
          },
        },
        // A pull request to review on an issue that's yours.
        { assigneeUserId: me, ...open, pullRequests: { some: { state: "OPEN" } } },
      ],
    }),
    find({ assigneeUserId: me, ...open }, SECTION_LIMIT * 2),
    find({
      assigneeUserId: me,
      column: { category: "DONE" },
      updatedAt: { gte: new Date(now.getTime() - 7 * DAY) },
    }),
    find({ reporterUserId: me, ...open }),
  ]);

  const urgent = byUrgency(now);
  const needsYouIds = new Set(waiting.map((c) => c.id));
  const rest = assigned.filter((c) => !needsYouIds.has(c.id));
  return {
    needsYou: waiting.sort(urgent),
    inProgress: rest.filter((c) => c.column.category === "IN_PROGRESS").sort(urgent).slice(0, SECTION_LIMIT),
    todo: rest.filter((c) => c.column.category === "TODO").sort(urgent).slice(0, SECTION_LIMIT),
    doneThisWeek: done,
    created: created.sort(urgent),
  };
}
