import { NextResponse } from "next/server";

import { findOwnedTask, getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { updateTaskSchema } from "@/lib/validations/task";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/tasks/[id] → the full task.
//
// Returns every field (description, priority, dueDate, labels) so F04's detail
// modal can reuse this endpoint without a new route.
export async function GET(_request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedTask(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const task = await db.task.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      dueDate: true,
      position: true,
      columnId: true,
      labels: { select: { id: true, name: true, color: true } },
    },
  });

  return NextResponse.json({ task });
}

// PATCH /api/tasks/[id] {title?, ...} → update.
//
// F03 only updates `title`. updateTaskSchema already permits F04's other
// fields; we map exactly what's present so unset keys are left untouched
// (keeping this handler additive for F04 to extend).
export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedTask(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  // Only assign keys that were actually provided. F03 sends `title`; F04 will
  // extend this map with description/priority/dueDate/labels.
  const { title } = parsed.data;
  const data: { title?: string } = {};
  if (title !== undefined) data.title = title;

  const task = await db.task.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      position: true,
      priority: true,
      dueDate: true,
      columnId: true,
    },
  });

  return NextResponse.json({ task });
}

// DELETE /api/tasks/[id] → delete the task. The UI confirms first.
export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedTask(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  await db.task.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
