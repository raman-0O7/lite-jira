import type { Prisma } from "@prisma/client";

import { planMove } from "@/lib/board-dnd";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { findColumnInWorkspace } from "@/lib/services/columns";
import type { Ctx } from "@/lib/services/context";
import { badRequest, notFound } from "@/lib/services/errors";
import {
  createTaskSchema,
  moveTaskSchema,
  updateTaskSchema,
} from "@/lib/validations/task";

const labelSelect = { select: { id: true, name: true, color: true } } as const;

/** The card shape embedded in a column (TaskStub on the client). */
const stubSelect = {
  id: true,
  title: true,
  position: true,
  priority: true,
  dueDate: true,
  labels: labelSelect,
} satisfies Prisma.TaskSelect;

/** Every editable field (TaskFull on the client). */
const fullSelect = {
  ...stubSelect,
  description: true,
  columnId: true,
} satisfies Prisma.TaskSelect;

/** Resolve a task whose column → board is in the ctx workspace, or throw 404. */
async function findTaskInWorkspace(
  client: Prisma.TransactionClient,
  ctx: Ctx,
  taskId: string,
) {
  const task = await client.task.findFirst({
    where: { id: taskId, column: { board: { workspaceId: ctx.workspaceId } } },
    select: {
      ...fullSelect,
      column: { select: { boardId: true } },
    },
  });
  if (!task) throw notFound("Task not found");
  return task;
}

export async function getTask(ctx: Ctx, taskId: string) {
  authorize(ctx, "board.read");
  const task = await db.task.findFirst({
    where: { id: taskId, column: { board: { workspaceId: ctx.workspaceId } } },
    select: fullSelect,
  });
  if (!task) throw notFound("Task not found");
  return task;
}

/**
 * Append a task at max(position)+1. Only the title is used at creation; the
 * rest of createTaskSchema validates but is set through updateTask.
 */
export async function createTask(
  ctx: Ctx,
  columnId: string,
  input: unknown,
) {
  authorize(ctx, "task.write");
  const { title } = createTaskSchema.parse(input);

  return db.$transaction(async (tx) => {
    const column = await findColumnInWorkspace(tx, ctx, columnId);
    const last = await tx.task.findFirst({
      where: { columnId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const task = await tx.task.create({
      data: { title, columnId, position: last ? last.position + 1 : 0 },
      select: stubSelect,
    });
    await recordActivity(tx, ctx, {
      action: "task.created",
      boardId: column.boardId,
      taskId: task.id,
      data: { title, columnId },
    });
    return task;
  });
}

/**
 * Update any subset of a task's fields. Keys absent from the input are left
 * untouched; `description` / `dueDate` accept null to clear; `labelIds`
 * replaces the task's labels wholesale and must all belong to its board.
 */
export async function updateTask(
  ctx: Ctx,
  taskId: string,
  input: unknown,
) {
  authorize(ctx, "task.write");
  const { title, description, priority, dueDate, labelIds } =
    updateTaskSchema.parse(input);

  return db.$transaction(async (tx) => {
    const before = await findTaskInWorkspace(tx, ctx, taskId);
    const boardId = before.column.boardId;

    const data: Prisma.TaskUpdateInput = {};
    const changes: Record<string, Prisma.InputJsonValue> = {};
    if (title !== undefined && title !== before.title) {
      data.title = title;
      changes.title = { from: before.title, to: title };
    }
    if (description !== undefined) {
      data.description = description ?? null;
      // Record that it changed, not the text, to keep history rows small.
      if ((description ?? null) !== before.description) changes.description = true;
    }
    if (priority !== undefined && priority !== before.priority) {
      data.priority = priority;
      changes.priority = { from: before.priority, to: priority };
    }
    if (dueDate !== undefined) {
      const next = dueDate ?? null;
      data.dueDate = next;
      if (next?.getTime() !== before.dueDate?.getTime()) {
        changes.dueDate = {
          from: before.dueDate?.toISOString() ?? null,
          to: next?.toISOString() ?? null,
        };
      }
    }
    if (labelIds !== undefined) {
      const unique = [...new Set(labelIds)];
      if (unique.length > 0) {
        const found = await tx.label.count({
          where: { id: { in: unique }, boardId },
        });
        if (found !== unique.length) throw notFound("Label not found");
      }
      data.labels = { set: unique.map((id) => ({ id })) };
      const previous = new Set(before.labels.map((l) => l.id));
      const added = unique.filter((id) => !previous.has(id));
      const removed = [...previous].filter((id) => !unique.includes(id));
      if (added.length || removed.length) changes.labels = { added, removed };
    }

    const task = await tx.task.update({
      where: { id: taskId },
      data,
      select: fullSelect,
    });
    if (Object.keys(changes).length > 0) {
      await recordActivity(tx, ctx, {
        action: "task.updated",
        boardId,
        taskId,
        data: { changes },
      });
    }
    return task;
  });
}

export async function deleteTask(ctx: Ctx, taskId: string) {
  authorize(ctx, "task.write");
  await db.$transaction(async (tx) => {
    const task = await findTaskInWorkspace(tx, ctx, taskId);
    await tx.task.delete({ where: { id: taskId } });
    await recordActivity(tx, ctx, {
      action: "task.deleted",
      boardId: task.column.boardId,
      taskId,
      data: { title: task.title },
    });
  });
}

/**
 * Reposition a task within or across columns of the same board.
 *
 * Authoritative algorithm (Feature 03), all in one transaction:
 *  1. Load the target column's tasks ordered by position, EXCLUDING the moved task.
 *  2. Insert the moved task at `toPosition`, clamped to [0, len] (planMove).
 *  3. Reindex the target column to 0..n-1; for a cross-column move also
 *     reindex the source column.
 */
export async function moveTask(ctx: Ctx, input: unknown) {
  authorize(ctx, "task.write");
  const { taskId, toColumnId, toPosition } = moveTaskSchema.parse(input);

  await db.$transaction(async (tx) => {
    const task = await findTaskInWorkspace(tx, ctx, taskId);
    const target = await findColumnInWorkspace(tx, ctx, toColumnId);
    // Labels are board-scoped, so a task never leaves its board.
    if (target.boardId !== task.column.boardId) {
      throw badRequest("Tasks can only move between columns of the same board");
    }

    const sourceColumnId = task.columnId;
    const sameColumn = sourceColumnId === toColumnId;

    const targetSiblings = await tx.task.findMany({
      where: { columnId: toColumnId, id: { not: taskId } },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const sourceSiblings = sameColumn
      ? targetSiblings
      : await tx.task.findMany({
          where: { columnId: sourceColumnId, id: { not: taskId } },
          orderBy: { position: "asc" },
          select: { id: true },
        });

    const plan = planMove({
      taskId,
      sameColumn,
      sourceSiblings,
      targetSiblings,
      toPosition,
    });

    for (const [position, id] of plan.target.entries()) {
      await tx.task.update({
        where: { id },
        data: id === taskId ? { columnId: toColumnId, position } : { position },
      });
    }
    for (const [position, id] of (plan.source ?? []).entries()) {
      await tx.task.update({ where: { id }, data: { position } });
    }

    await recordActivity(tx, ctx, {
      action: "task.moved",
      boardId: target.boardId,
      taskId,
      data: {
        fromColumnId: sourceColumnId,
        toColumnId,
        fromPosition: task.position,
        toPosition: plan.target.indexOf(taskId),
      },
    });
  });
}
