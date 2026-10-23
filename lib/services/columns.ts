import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { findBoardInWorkspace } from "@/lib/services/boards";
import type { Ctx } from "@/lib/services/context";
import { badRequest, notFound } from "@/lib/services/errors";
import {
  createColumnSchema,
  reorderColumnsSchema,
  updateColumnSchema,
} from "@/lib/validations/column";

const columnSelect = { id: true, name: true, position: true } as const;

/** Resolve a column whose board is in the ctx workspace, or throw 404. */
export async function findColumnInWorkspace(
  client: Prisma.TransactionClient,
  ctx: Ctx,
  columnId: string,
) {
  const column = await client.column.findFirst({
    where: { id: columnId, board: { workspaceId: ctx.workspaceId } },
    select: { id: true, name: true, boardId: true },
  });
  if (!column) throw notFound("Column not found");
  return column;
}

/** Append a column at max(position)+1 (gap strategy, PLAN §7). */
export async function createColumn(
  ctx: Ctx,
  boardId: string,
  input: unknown,
) {
  authorize(ctx, "column.write");
  const { name } = createColumnSchema.parse(input);

  return db.$transaction(async (tx) => {
    await findBoardInWorkspace(tx, ctx, boardId);
    const last = await tx.column.findFirst({
      where: { boardId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const column = await tx.column.create({
      data: { name, boardId, position: last ? last.position + 1 : 0 },
      select: columnSelect,
    });
    await recordActivity(tx, ctx, {
      action: "column.created",
      boardId,
      data: { columnId: column.id, name },
    });
    return { ...column, tasks: [] };
  });
}

export async function renameColumn(
  ctx: Ctx,
  columnId: string,
  input: unknown,
) {
  authorize(ctx, "column.write");
  const { name } = updateColumnSchema.parse(input);

  return db.$transaction(async (tx) => {
    const before = await findColumnInWorkspace(tx, ctx, columnId);
    const column = await tx.column.update({
      where: { id: columnId },
      data: { name },
      select: columnSelect,
    });
    await recordActivity(tx, ctx, {
      action: "column.renamed",
      boardId: before.boardId,
      data: { columnId, from: before.name, to: name },
    });
    return column;
  });
}

/** Delete a column; Prisma cascades remove its tasks. The UI warns first. */
export async function deleteColumn(ctx: Ctx, columnId: string) {
  authorize(ctx, "column.write");
  await db.$transaction(async (tx) => {
    const column = await findColumnInWorkspace(tx, ctx, columnId);
    await tx.column.delete({ where: { id: columnId } });
    await recordActivity(tx, ctx, {
      action: "column.deleted",
      boardId: column.boardId,
      data: { columnId, name: column.name },
    });
  });
}

/**
 * Rewrite every column position from the supplied order so positions stay
 * 0..n-1 contiguous. The ids must be exactly the board's current columns — no
 * more, no fewer, no foreign ids — which blocks reordering with stale ids.
 */
export async function reorderColumns(
  ctx: Ctx,
  input: unknown,
) {
  authorize(ctx, "column.write");
  const { boardId, orderedIds } = reorderColumnsSchema.parse(input);

  await db.$transaction(async (tx) => {
    await findBoardInWorkspace(tx, ctx, boardId);
    const columns = await tx.column.findMany({
      where: { boardId },
      select: { id: true },
    });
    const existing = new Set(columns.map((c) => c.id));
    const mismatch =
      orderedIds.length !== existing.size ||
      new Set(orderedIds).size !== existing.size ||
      orderedIds.some((id) => !existing.has(id));
    if (mismatch) {
      throw badRequest("orderedIds must match the board's columns exactly");
    }

    for (const [position, id] of orderedIds.entries()) {
      await tx.column.update({ where: { id }, data: { position } });
    }
    await recordActivity(tx, ctx, {
      action: "column.reordered",
      boardId,
      data: { orderedIds },
    });
  });
}
