import { NextResponse } from "next/server";

import { findOwnedBoard, getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { createLabelSchema } from "@/lib/validations/label";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/boards/[id]/labels → the board's labels (ownership-scoped).
export async function GET(_request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: boardId } = await params;

  const owned = await findOwnedBoard(boardId, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  const labels = await db.label.findMany({
    where: { boardId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, color: true },
  });

  return NextResponse.json({ labels });
}

// POST /api/boards/[id]/labels {name, color} → create a label on the board.
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

  const parsed = createLabelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const label = await db.label.create({
    data: { name: parsed.data.name, color: parsed.data.color, boardId },
    select: { id: true, name: true, color: true },
  });

  return NextResponse.json({ label }, { status: 201 });
}
