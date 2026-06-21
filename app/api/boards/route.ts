import { NextResponse } from "next/server";

import { getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { createBoardSchema } from "@/lib/validations/board";

// GET /api/boards → the current user's boards with column/task counts.
export async function GET() {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const boards = await db.board.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { columns: true } },
    },
  });

  return NextResponse.json({
    boards: boards.map((board) => ({
      id: board.id,
      name: board.name,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      columnCount: board._count.columns,
    })),
  });
}

// Columns seeded into every new board, in display order.
const DEFAULT_COLUMNS = ["To Do", "In Progress", "Done"];

// POST /api/boards {name} → create a board and seed its default columns.
export async function POST(request: Request) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createBoardSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Board + its three seeded columns are created atomically.
  const board = await db.board.create({
    data: {
      name: parsed.data.name,
      userId: user.id,
      columns: {
        create: DEFAULT_COLUMNS.map((name, position) => ({ name, position })),
      },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { columns: true } },
    },
  });

  return NextResponse.json(
    {
      board: {
        id: board.id,
        name: board.name,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
        columnCount: board._count.columns,
      },
    },
    { status: 201 },
  );
}
