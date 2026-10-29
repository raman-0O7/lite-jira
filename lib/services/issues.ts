import { type IssueType, Prisma } from "@prisma/client";

import { planMove } from "@/lib/board-dnd";
import { db } from "@/lib/db";
import { onCategoryChange } from "@/lib/github/sync";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { findColumnInWorkspace } from "@/lib/services/columns";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { badRequest, notFound } from "@/lib/services/errors";
import {
  cardSelect,
  fullSelect,
  parseKey,
  toCard,
  toFull,
} from "@/lib/services/issue-shapes";
import { projectScope } from "@/lib/services/scope";
import {
  createIssueSchema,
  createSubIssueSchema,
  moveIssueSchema,
  updateIssueSchema,
} from "@/lib/validations/issue";

/** The fields every rule check needs, scoped to the ctx workspace. */
async function findIssueInWorkspace(
  client: Prisma.TransactionClient,
  ctx: Ctx,
  issueId: string,
) {
  const issue = await client.issue.findFirst({
    where: { id: issueId, project: projectScope(ctx) },
    select: {
      id: true,
      number: true,
      type: true,
      title: true,
      description: true,
      acceptanceCriteria: true,
      priority: true,
      dueDate: true,
      estimate: true,
      position: true,
      columnId: true,
      projectId: true,
      parentId: true,
      epicId: true,
      assigneeUserId: true,
      assigneeAgentId: true,
      labels: { select: { id: true } },
      project: { select: { key: true } },
      column: { select: { category: true } },
      _count: { select: { epicIssues: true } },
    },
  });
  if (!issue) throw notFound("Issue not found");
  return issue;
}

/** Hand out the project's next issue number. The row update serializes concurrent creates. */
async function nextNumber(tx: Prisma.TransactionClient, projectId: string) {
  const { issueCounter } = await tx.project.update({
    where: { id: projectId },
    data: { issueCounter: { increment: 1 } },
    select: { issueCounter: true },
  });
  return issueCounter;
}

async function nextPosition(tx: Prisma.TransactionClient, columnId: string) {
  const last = await tx.issue.findFirst({
    where: { columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  return last ? last.position + 1 : 0;
}

async function loadFull(client: Prisma.TransactionClient, issueId: string) {
  return toFull(
    await client.issue.findUniqueOrThrow({ where: { id: issueId }, select: fullSelect }),
  );
}

export async function getIssue(ctx: Ctx, issueId: string) {
  authorize(ctx, "project.read");
  const issue = await db.issue.findFirst({
    where: { id: issueId, project: projectScope(ctx) },
    select: fullSelect,
  });
  if (!issue) throw notFound("Issue not found");
  return toFull(issue);
}

export async function getIssueByKey(ctx: Ctx, key: string) {
  authorize(ctx, "project.read");
  const parsed = parseKey(key);
  if (!parsed) throw notFound("Issue not found");
  const issue = await db.issue.findFirst({
    where: {
      number: parsed.number,
      project: { ...projectScope(ctx), key: parsed.projectKey },
    },
    select: fullSelect,
  });
  if (!issue) throw notFound("Issue not found");
  return toFull(issue);
}

/** Append an issue to a column. Sub-issues go through createSubIssue. */
export async function createIssue(ctx: Ctx, columnId: string, input: unknown) {
  authorize(ctx, "issue.write");
  const { title, type, priority, description, assigneeUserId } = createIssueSchema.parse(input);

  return db.$transaction(async (tx) => {
    const column = await findColumnInWorkspace(tx, ctx, columnId);
    if (assigneeUserId) await assertAssignable(tx, ctx, assigneeUserId);
    const project = await tx.project.findUniqueOrThrow({
      where: { id: column.projectId },
      select: { key: true },
    });
    const issue = await tx.issue.create({
      data: {
        title,
        type,
        priority,
        description: description || null,
        assigneeUserId: assigneeUserId ?? null,
        columnId,
        projectId: column.projectId,
        number: await nextNumber(tx, column.projectId),
        position: await nextPosition(tx, columnId),
        reporterUserId: actingUserId(ctx),
      },
      select: cardSelect,
    });
    const card = toCard(project.key, issue);
    await recordActivity(tx, ctx, {
      action: "issue.created",
      projectId: column.projectId,
      issueId: issue.id,
      data: { key: card.key, title, type, columnId, ...(assigneeUserId ? { assigneeUserId } : {}) },
    });
    return card;
  });
}

/**
 * Create a sub-issue under `parentId`. It is always type SUBTASK, lives in the
 * parent's project, and starts in the project's first TODO column.
 */
export async function createSubIssue(ctx: Ctx, parentId: string, input: unknown) {
  authorize(ctx, "issue.write");
  const { title } = createSubIssueSchema.parse(input);

  return db.$transaction(async (tx) => {
    const parent = await findIssueInWorkspace(tx, ctx, parentId);
    if (parent.type === "SUBTASK") {
      throw badRequest("Sub-issues can't have their own sub-issues");
    }
    if (parent.type === "EPIC") {
      throw badRequest("Epics group issues with the epic field, not sub-issues");
    }
    const column =
      (await tx.column.findFirst({
        where: { projectId: parent.projectId, category: "TODO" },
        orderBy: { position: "asc" },
        select: { id: true },
      })) ??
      (await tx.column.findFirstOrThrow({
        where: { projectId: parent.projectId },
        orderBy: { position: "asc" },
        select: { id: true },
      }));

    const issue = await tx.issue.create({
      data: {
        title,
        type: "SUBTASK",
        parentId,
        columnId: column.id,
        projectId: parent.projectId,
        number: await nextNumber(tx, parent.projectId),
        position: await nextPosition(tx, column.id),
        reporterUserId: actingUserId(ctx),
      },
      select: cardSelect,
    });
    const card = toCard(parent.project.key, issue);
    await recordActivity(tx, ctx, {
      action: "issue.created",
      projectId: parent.projectId,
      issueId: issue.id,
      data: { key: card.key, title, type: "SUBTASK", parentId },
    });
    return card;
  });
}

/** Issues can be assigned to the workspace's members, never to guests. */
async function assertAssignable(tx: Prisma.TransactionClient, ctx: Ctx, userId: string) {
  const member = await tx.membership.findFirst({
    where: { workspaceId: ctx.workspaceId, userId, role: { not: "GUEST" } },
    select: { id: true },
  });
  if (!member) throw badRequest("Assignee must be a member of this workspace");
}

type Changes = Record<string, Prisma.InputJsonValue>;

function change(changes: Changes, field: string, from: unknown, to: unknown) {
  const norm = (v: unknown) => (v instanceof Date ? v.toISOString() : (v ?? null));
  if (norm(from) !== norm(to)) {
    changes[field] = { from: norm(from), to: norm(to) } as Prisma.InputJsonValue;
  }
}

/**
 * Update any subset of an issue's fields. Absent keys are untouched; nullable
 * fields accept null to clear. Enforces the type / epic / assignee rules from
 * docs/features/07-issue-model.md.
 */
export async function updateIssue(ctx: Ctx, issueId: string, input: unknown) {
  authorize(ctx, "issue.write");
  const patch = updateIssueSchema.parse(input);

  return db.$transaction(async (tx) => {
    const before = await findIssueInWorkspace(tx, ctx, issueId);
    const data: Prisma.IssueUncheckedUpdateInput = {};
    const changes: Changes = {};

    // ---- type ----
    const nextType: IssueType = patch.type ?? before.type;
    if (patch.type !== undefined && patch.type !== before.type) {
      if (before.type === "SUBTASK" || patch.type === "SUBTASK") {
        throw badRequest("A sub-issue's type can't be changed, and issues can't become sub-issues");
      }
      if (before.type === "EPIC" && before._count.epicIssues > 0) {
        throw badRequest("Remove this epic's issues before changing its type");
      }
      data.type = patch.type;
      change(changes, "type", before.type, patch.type);
    }

    // ---- epic ----
    const nextEpicId = patch.epicId !== undefined ? (patch.epicId ?? null) : before.epicId;
    if (nextEpicId && (nextType === "EPIC" || nextType === "SUBTASK")) {
      throw badRequest(
        nextType === "EPIC" ? "An epic can't belong to another epic" : "Sub-issues follow their parent's epic",
      );
    }
    if (patch.epicId !== undefined && nextEpicId !== before.epicId) {
      if (nextEpicId) {
        const epic = await tx.issue.findFirst({
          where: { id: nextEpicId, projectId: before.projectId, type: "EPIC" },
          select: { id: true },
        });
        if (!epic) throw badRequest("Epic not found in this project");
      }
      data.epicId = nextEpicId;
      change(changes, "epicId", before.epicId, nextEpicId);
    }

    // ---- assignee ----
    if (patch.assigneeUserId !== undefined) {
      const next = patch.assigneeUserId ?? null;
      if (next) await assertAssignable(tx, ctx, next);
      data.assigneeUserId = next;
      change(changes, "assigneeUserId", before.assigneeUserId, next);
      // The agent works for the assignee (a Claude Code agent runs on its
      // owner's account), so handing the issue to someone else stops it.
      if (before.assigneeAgentId && next !== before.assigneeUserId) {
        data.assigneeAgentId = null;
        data.claimedByAgentId = null;
        data.claimedAt = null;
        change(changes, "assigneeAgentId", before.assigneeAgentId, null);
        await tx.agentRun.updateMany({
          where: { issueId, status: { in: ["QUEUED", "DISPATCHED", "RUNNING", "NEEDS_INPUT", "PR_OPEN"] } },
          data: { status: "CANCELLED", error: "Reassigned", finishedAt: new Date() },
        });
      }
    }

    // ---- plain fields ----
    if (patch.title !== undefined) {
      data.title = patch.title;
      change(changes, "title", before.title, patch.title);
    }
    if (patch.priority !== undefined) {
      data.priority = patch.priority;
      change(changes, "priority", before.priority, patch.priority);
    }
    if (patch.dueDate !== undefined) {
      data.dueDate = patch.dueDate ?? null;
      change(changes, "dueDate", before.dueDate, patch.dueDate);
    }
    if (patch.estimate !== undefined) {
      data.estimate = patch.estimate ?? null;
      change(changes, "estimate", before.estimate, patch.estimate);
    }
    // Long text: record that it changed, not the text, to keep history rows small.
    for (const field of ["description", "acceptanceCriteria"] as const) {
      if (patch[field] === undefined) continue;
      const next = patch[field] || null;
      data[field] = next;
      if (next !== before[field]) changes[field] = true;
    }

    // ---- labels (replace wholesale; all must belong to the project) ----
    if (patch.labelIds !== undefined) {
      const unique = [...new Set(patch.labelIds)];
      if (unique.length > 0) {
        const found = await tx.label.count({
          where: { id: { in: unique }, projectId: before.projectId },
        });
        if (found !== unique.length) throw notFound("Label not found");
      }
      data.labels = { set: unique.map((id) => ({ id })) };
      const previous = new Set(before.labels.map((l) => l.id));
      const added = unique.filter((id) => !previous.has(id));
      const removed = [...previous].filter((id) => !unique.includes(id));
      if (added.length || removed.length) changes.labels = { added, removed };
    }

    await tx.issue.update({ where: { id: issueId }, data });
    if (Object.keys(changes).length > 0) {
      await recordActivity(tx, ctx, {
        action: "issue.updated",
        projectId: before.projectId,
        issueId,
        data: { changes },
      });
    }
    return loadFull(tx, issueId);
  });
}

/** Delete an issue. Its sub-issues go with it; an epic's issues are detached. */
export async function deleteIssue(ctx: Ctx, issueId: string) {
  authorize(ctx, "issue.write");
  await db.$transaction(async (tx) => {
    const issue = await findIssueInWorkspace(tx, ctx, issueId);
    await tx.issue.delete({ where: { id: issueId } });
    await recordActivity(tx, ctx, {
      action: "issue.deleted",
      projectId: issue.projectId,
      issueId,
      data: { key: `${issue.project.key}-${issue.number}`, title: issue.title },
    });
  });
}

/**
 * Reposition an issue within or across columns of the same project.
 *
 * Authoritative algorithm (Feature 03), all in one transaction:
 *  1. Load the target column's issues ordered by position, EXCLUDING the moved one.
 *  2. Insert the moved issue at `toPosition`, clamped to [0, len] (planMove).
 *  3. Reindex the target column to 0..n-1; for a cross-column move also
 *     reindex the source column.
 */
export async function moveIssue(ctx: Ctx, input: unknown) {
  authorize(ctx, "issue.write");
  const { issueId, toColumnId, toPosition } = moveIssueSchema.parse(input);

  const moved = await db.$transaction(async (tx) => {
    const issue = await findIssueInWorkspace(tx, ctx, issueId);
    const target = await findColumnInWorkspace(tx, ctx, toColumnId);
    // Labels and keys are project-scoped, so an issue never leaves its project.
    if (target.projectId !== issue.projectId) {
      throw badRequest("Issues can only move between columns of the same project");
    }

    const sourceColumnId = issue.columnId;
    const sameColumn = sourceColumnId === toColumnId;

    const targetSiblings = await tx.issue.findMany({
      where: { columnId: toColumnId, id: { not: issueId } },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const sourceSiblings = sameColumn
      ? targetSiblings
      : await tx.issue.findMany({
          where: { columnId: sourceColumnId, id: { not: issueId } },
          orderBy: { position: "asc" },
          select: { id: true },
        });

    const plan = planMove({
      taskId: issueId,
      sameColumn,
      sourceSiblings,
      targetSiblings,
      toPosition,
    });

    for (const [position, id] of plan.target.entries()) {
      await tx.issue.update({
        where: { id },
        data: id === issueId ? { columnId: toColumnId, position } : { position },
      });
    }
    for (const [position, id] of (plan.source ?? []).entries()) {
      await tx.issue.update({ where: { id }, data: { position } });
    }

    await recordActivity(tx, ctx, {
      action: "issue.moved",
      projectId: issue.projectId,
      issueId,
      data: {
        fromColumnId: sourceColumnId,
        toColumnId,
        fromPosition: issue.position,
        toPosition: plan.target.indexOf(issueId),
        toCategory: target.category,
      },
    });
    return { fromCategory: issue.column.category, toCategory: target.category };
  });

  if (moved.fromCategory !== moved.toCategory) {
    onCategoryChange(ctx, issueId, moved.fromCategory, moved.toCategory);
  }
  return moved;
}

/**
 * Create an issue from a GitHub issue (docs/features/11-github-app.md "Import").
 * The link is created in the same transaction; a repeat import is a no-op
 * (returns null).
 */
export async function createImportedIssue(
  ctx: Ctx,
  input: {
    projectId: string;
    columnId: string;
    title: string;
    description: string | null;
    assigneeUserId: string | null;
    labelIds: string[];
    link: { projectRepoId: string; repoFullName: string; number: number; url: string };
  },
) {
  authorize(ctx, "issue.write");
  try {
    return await db.$transaction(async (tx) => {
      const project = await tx.project.findFirst({
        where: { id: input.projectId, ...projectScope(ctx) },
        select: { key: true },
      });
      if (!project) throw notFound("Project not found");
      const issue = await tx.issue.create({
        data: {
          title: input.title.trim().slice(0, 200) || `${input.link.repoFullName}#${input.link.number}`,
          description: input.description?.slice(0, 10_000) || null,
          assigneeUserId: input.assigneeUserId,
          columnId: input.columnId,
          projectId: input.projectId,
          number: await nextNumber(tx, input.projectId),
          position: await nextPosition(tx, input.columnId),
          source: "GITHUB",
          labels: { connect: input.labelIds.map((id) => ({ id })) },
          githubLink: { create: input.link },
        },
        select: { id: true, number: true },
      });
      const key = `${project.key}-${issue.number}`;
      await recordActivity(tx, ctx, {
        action: "issue.created",
        projectId: input.projectId,
        issueId: issue.id,
        data: {
          key,
          title: input.title,
          type: "TASK",
          columnId: input.columnId,
          source: `${input.link.repoFullName}#${input.link.number}`,
          ...(input.assigneeUserId ? { assigneeUserId: input.assigneeUserId } : {}),
        },
      });
      return { id: issue.id, key };
    });
  } catch (error) {
    // Lost a race with another import of the same GitHub issue.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    throw error;
  }
}
