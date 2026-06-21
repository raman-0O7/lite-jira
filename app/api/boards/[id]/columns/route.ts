import { NextResponse } from "next/server";

import { findOwnedBoard, getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { createColumnSchema } from "@/lib/validations/column";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/boards/[id]/columns {name} → append a column at max(position)+1.
export async function POST(request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: boardId } = await params;

  const owned = await findOwnedBoard(boardId, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createColumnSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Append: next position is one past the current max (gap strategy per PLAN §7).
  const last = await db.column.findFirst({
    where: { boardId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const nextPosition = last ? last.position + 1 : 0;

  const column = await db.column.create({
    data: { name: parsed.data.name, position: nextPosition, boardId },
    select: { id: true, name: true, position: true },
  });

  return NextResponse.json(
    { column: { ...column, tasks: [] } },
    { status: 201 },
  );
}
