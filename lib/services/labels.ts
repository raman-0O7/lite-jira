import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { findBoardInWorkspace } from "@/lib/services/boards";
import type { Ctx } from "@/lib/services/context";
import { notFound } from "@/lib/services/errors";
import { createLabelSchema, updateLabelSchema } from "@/lib/validations/label";

const labelSelect = { id: true, name: true, color: true } as const;

async function findLabelInWorkspace(
  client: Prisma.TransactionClient,
  ctx: Ctx,
  labelId: string,
) {
  const label = await client.label.findFirst({
    where: { id: labelId, board: { workspaceId: ctx.workspaceId } },
    select: { ...labelSelect, boardId: true },
  });
  if (!label) throw notFound("Label not found");
  return label;
}

export async function listLabels(ctx: Ctx, boardId: string) {
  authorize(ctx, "board.read");
  await findBoardInWorkspace(db, ctx, boardId);
  return db.label.findMany({
    where: { boardId },
    orderBy: { createdAt: "asc" },
    select: labelSelect,
  });
}

export async function createLabel(
  ctx: Ctx,
  boardId: string,
  input: unknown,
) {
  authorize(ctx, "label.write");
  const { name, color } = createLabelSchema.parse(input);

  return db.$transaction(async (tx) => {
    await findBoardInWorkspace(tx, ctx, boardId);
    const label = await tx.label.create({
      data: { name, color, boardId },
      select: labelSelect,
    });
    await recordActivity(tx, ctx, {
      action: "label.created",
      boardId,
      data: { labelId: label.id, name, color },
    });
    return label;
  });
}

export async function updateLabel(
  ctx: Ctx,
  labelId: string,
  input: unknown,
) {
  authorize(ctx, "label.write");
  const { name, color } = updateLabelSchema.parse(input);

  return db.$transaction(async (tx) => {
    const before = await findLabelInWorkspace(tx, ctx, labelId);
    const data: { name?: string; color?: string } = {};
    if (name !== undefined) data.name = name;
    if (color !== undefined) data.color = color;

    const label = await tx.label.update({
      where: { id: labelId },
      data,
      select: labelSelect,
    });
    await recordActivity(tx, ctx, {
      action: "label.updated",
      boardId: before.boardId,
      data: {
        labelId,
        from: { name: before.name, color: before.color },
        to: { name: label.name, color: label.color },
      },
    });
    return label;
  });
}

/** Delete a label; Prisma detaches it from any tasks. */
export async function deleteLabel(ctx: Ctx, labelId: string) {
  authorize(ctx, "label.write");
  await db.$transaction(async (tx) => {
    const label = await findLabelInWorkspace(tx, ctx, labelId);
    await tx.label.delete({ where: { id: labelId } });
    await recordActivity(tx, ctx, {
      action: "label.deleted",
      boardId: label.boardId,
      data: { labelId, name: label.name },
    });
  });
}
