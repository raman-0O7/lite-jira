import { NextResponse } from "next/server";

import { findOwnedColumn, getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { createTaskSchema } from "@/lib/validations/task";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/columns/[id]/tasks {title} → append a task at max(position)+1.
//
// F03 only supplies a title; the broader createTaskSchema (description,
// priority, dueDate, labels) is additive for F04 — extra fields validate but
// F03 never sends them, so creation stays "title only".
export async function POST(request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: columnId } = await params;

  const owned = await findOwnedColumn(columnId, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Append: next position is one past the current max (gap strategy per PLAN §7).
  const last = await db.task.findFirst({
    where: { columnId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  const nextPosition = last ? last.position + 1 : 0;

  const task = await db.task.create({
    data: {
      title: parsed.data.title,
      position: nextPosition,
      columnId,
    },
    select: {
      id: true,
      title: true,
      position: true,
      priority: true,
      dueDate: true,
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
