import { NextResponse } from "next/server";

import { findOwnedBoard, getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { updateBoardSchema } from "@/lib/validations/board";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/boards/[id] → the board with its ordered columns.
// Columns include their tasks (ordered by position) so F03 can render the
// Kanban directly off this payload without a second round-trip.
export async function GET(_request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const board = await db.board.findFirst({
    where: { id, userId: user.id },
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
          // Tasks are owned by F03; we expose enough for it to render them
          // without editing F02's query.
          tasks: {
            orderBy: { position: "asc" },
            select: {
              id: true,
              title: true,
              position: true,
              priority: true,
              dueDate: true,
              // F04: card chips need each task's labels. Additive to F03's
              // select; the rest of the task shape is unchanged.
              labels: { select: { id: true, name: true, color: true } },
            },
          },
        },
      },
    },
  });

  // Not found OR not owned → 404 (never leak existence).
  if (!board) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  return NextResponse.json({ board });
}

// PATCH /api/boards/[id] {name} → rename.
export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedBoard(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateBoardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const board = await db.board.update({
    where: { id },
    data: { name: parsed.data.name },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { columns: true } },
    },
  });

  return NextResponse.json({
    board: {
      id: board.id,
      name: board.name,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      columnCount: board._count.columns,
    },
  });
}

// DELETE /api/boards/[id] → delete (Prisma cascade removes columns + tasks).
export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedBoard(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  await db.board.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
