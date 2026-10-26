import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import type { Ctx } from "@/lib/services/context";
import { badRequest, notFound } from "@/lib/services/errors";
import { findProjectInWorkspace } from "@/lib/services/projects";
import { projectScope } from "@/lib/services/scope";
import {
  createColumnSchema,
  reorderColumnsSchema,
  updateColumnSchema,
} from "@/lib/validations/column";

const columnSelect = {
  id: true,
  name: true,
  position: true,
  category: true,
} as const;

/** Resolve a column whose project is in the ctx workspace, or throw 404. */
export async function findColumnInWorkspace(
  client: Prisma.TransactionClient,
  ctx: Ctx,
  columnId: string,
) {
  const column = await client.column.findFirst({
    where: { id: columnId, project: projectScope(ctx) },
    select: { ...columnSelect, projectId: true },
  });
  if (!column) throw notFound("Column not found");
  return column;
}

/** Append a column at max(position)+1 (gap strategy, PLAN §7). */
export async function createColumn(ctx: Ctx, projectId: string, input: unknown) {
  authorize(ctx, "column.write");
  const { name, category } = createColumnSchema.parse(input);

  return db.$transaction(async (tx) => {
    await findProjectInWorkspace(tx, ctx, projectId);
    const last = await tx.column.findFirst({
      where: { projectId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const column = await tx.column.create({
      data: {
        name,
        category,
        projectId,
        position: last ? last.position + 1 : 0,
      },
      select: columnSelect,
    });
    await recordActivity(tx, ctx, {
      action: "column.created",
      projectId,
      data: { columnId: column.id, name, category: column.category },
    });
    return { ...column, issues: [] };
  });
}

/** Rename and/or recategorize a column. */
export async function updateColumn(ctx: Ctx, columnId: string, input: unknown) {
  authorize(ctx, "column.write");
  const { name, category } = updateColumnSchema.parse(input);

  return db.$transaction(async (tx) => {
    const before = await findColumnInWorkspace(tx, ctx, columnId);
    const column = await tx.column.update({
      where: { id: columnId },
      data: { name, category },
      select: columnSelect,
    });
    await recordActivity(tx, ctx, {
      action: "column.updated",
      projectId: before.projectId,
      data: {
        columnId,
        ...(name !== undefined && name !== before.name && { name: { from: before.name, to: name } }),
        ...(category !== undefined &&
          category !== before.category && { category: { from: before.category, to: category } }),
      },
    });
    return column;
  });
}

/** Delete a column; Prisma cascades remove its issues. The UI warns first. */
export async function deleteColumn(ctx: Ctx, columnId: string) {
  authorize(ctx, "column.write");
  await db.$transaction(async (tx) => {
    const column = await findColumnInWorkspace(tx, ctx, columnId);
    await tx.column.delete({ where: { id: columnId } });
    await recordActivity(tx, ctx, {
      action: "column.deleted",
      projectId: column.projectId,
      data: { columnId, name: column.name },
    });
  });
}

/**
 * Rewrite every column position from the supplied order so positions stay
 * 0..n-1 contiguous. The ids must be exactly the project's current columns —
 * no more, no fewer, no duplicates, no foreign ids.
 */
export async function reorderColumns(ctx: Ctx, input: unknown) {
  authorize(ctx, "column.write");
  const { projectId, orderedIds } = reorderColumnsSchema.parse(input);

  await db.$transaction(async (tx) => {
    await findProjectInWorkspace(tx, ctx, projectId);
    const columns = await tx.column.findMany({
      where: { projectId },
      select: { id: true },
    });
    const existing = new Set(columns.map((c) => c.id));
    const mismatch =
      orderedIds.length !== existing.size ||
      new Set(orderedIds).size !== existing.size ||
      orderedIds.some((id) => !existing.has(id));
    if (mismatch) {
      throw badRequest("orderedIds must match the project's columns exactly");
    }

    for (const [position, id] of orderedIds.entries()) {
      await tx.column.update({ where: { id }, data: { position } });
    }
    await recordActivity(tx, ctx, {
      action: "column.reordered",
      projectId,
      data: { orderedIds },
    });
  });
}
