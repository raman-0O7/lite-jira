import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import type { Ctx } from "@/lib/services/context";
import { notFound } from "@/lib/services/errors";
import { createBoardSchema, updateBoardSchema } from "@/lib/validations/board";

/** Columns seeded into every new board, in display order. */
const DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"];

const summarySelect = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { columns: true } },
} satisfies Prisma.BoardSelect;

type SummaryRow = Prisma.BoardGetPayload<{ select: typeof summarySelect }>;

function toSummary(board: SummaryRow) {
  return {
    id: board.id,
    name: board.name,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    columnCount: board._count.columns,
  };
}

/**
 * Resolve a board inside the ctx workspace, or throw 404. Every board-scoped
 * service goes through this so a board id from another workspace never works.
 */
export async function findBoardInWorkspace(
  client: Prisma.TransactionClient,
  ctx: Ctx,
  boardId: string,
) {
  const board = await client.board.findFirst({
    where: { id: boardId, workspaceId: ctx.workspaceId },
    select: { id: true, name: true },
  });
  if (!board) throw notFound("Board not found");
  return board;
}

/** The board's id and name, or 404 — for pages that only need to know it exists here. */
export async function getBoard(ctx: Ctx, boardId: string) {
  authorize(ctx, "board.read");
  return findBoardInWorkspace(db, ctx, boardId);
}

export async function listBoards(ctx: Ctx) {
  authorize(ctx, "board.read");
  const boards = await db.board.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
    select: summarySelect,
  });
  return boards.map(toSummary);
}

/** The board with its ordered columns and their ordered tasks (the Kanban payload). */
export async function getBoardDetail(ctx: Ctx, boardId: string) {
  authorize(ctx, "board.read");
  const board = await db.board.findFirst({
    where: { id: boardId, workspaceId: ctx.workspaceId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      columns: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          position: true,
          tasks: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              position: true,
              priority: true,
              dueDate: true,
              labels: { select: { id: true, name: true, color: true } },
            },
          },
        },
      },
    },
  });
  if (!board) throw notFound("Board not found");
  return board;
}

export async function createBoard(
  ctx: Ctx,
  input: unknown,
) {
  authorize(ctx, "board.create");
  const { name } = createBoardSchema.parse(input);

  return db.$transaction(async (tx) => {
    const board = await tx.board.create({
      data: {
        name,
        workspaceId: ctx.workspaceId,
        columns: {
          create: DEFAULT_COLUMNS.map((column, position) => ({
            name: column,
            position,
          })),
        },
      },
      select: summarySelect,
    });
    await recordActivity(tx, ctx, {
      action: "board.created",
      boardId: board.id,
      data: { name },
    });
    return toSummary(board);
  });
}

export async function renameBoard(
  ctx: Ctx,
  boardId: string,
  input: unknown,
) {
  authorize(ctx, "board.update");
  const { name } = updateBoardSchema.parse(input);

  return db.$transaction(async (tx) => {
    const before = await findBoardInWorkspace(tx, ctx, boardId);
    const board = await tx.board.update({
      where: { id: boardId },
      data: { name },
      select: summarySelect,
    });
    await recordActivity(tx, ctx, {
      action: "board.renamed",
      boardId,
      data: { from: before.name, to: name },
    });
    return toSummary(board);
  });
}

/** Delete a board; Prisma cascades remove its columns, tasks, and labels. */
export async function deleteBoard(ctx: Ctx, boardId: string) {
  authorize(ctx, "board.delete");
  await db.$transaction(async (tx) => {
    const board = await findBoardInWorkspace(tx, ctx, boardId);
    await tx.board.delete({ where: { id: boardId } });
    await recordActivity(tx, ctx, {
      action: "board.deleted",
      boardId,
      data: { name: board.name },
    });
  });
}
