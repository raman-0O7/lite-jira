import type { Prisma } from "@prisma/client";
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

// PATCH /api/tasks/[id] {title?, description?, priority?, dueDate?, labelIds?}
//   → update.
//
// F03 only updates `title`. F04 extends this additively to also accept
// description / priority / dueDate / labels. `updateTaskSchema` already permits
// all of these; we map exactly what's present so unset keys are left untouched.
// Label assignment uses `set` semantics: the task's labels become exactly the
// passed `labelIds` (connect new, disconnect removed in one operation).
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

  // Only assign keys that were actually provided so unset fields stay as-is.
  // F03 sends `title`; F04 adds description / priority / dueDate / labels.
  const { title, description, priority, dueDate, labelIds } = parsed.data;
  const data: Prisma.TaskUpdateInput = {};
  if (title !== undefined) data.title = title;
  // description/dueDate are nullable: `null` clears, a value sets. `undefined`
  // (key absent) leaves them untouched.
  if (description !== undefined) data.description = description ?? null;
  if (priority !== undefined) data.priority = priority;
  if (dueDate !== undefined) data.dueDate = dueDate ?? null;

  if (labelIds !== undefined) {
    // Guard: every label must belong to this task's board, or we'd let a user
    // attach another board's labels. Resolve the task's board, then ensure all
    // requested labels live on it.
    const taskBoard = await db.task.findUnique({
      where: { id },
      select: { column: { select: { boardId: true } } },
    });
    const boardId = taskBoard?.column.boardId;

    if (labelIds.length > 0) {
      const ownedLabels = await db.label.findMany({
        where: { id: { in: labelIds }, boardId },
        select: { id: true },
      });
      if (ownedLabels.length !== new Set(labelIds).size) {
        return NextResponse.json(
          { error: "Label not found" },
          { status: 404 },
        );
      }
    }

    data.labels = { set: labelIds.map((labelId) => ({ id: labelId })) };
  }

  const task = await db.task.update({
    where: { id },
    data,
    select: {
      id: true,
      title: true,
      description: true,
      position: true,
      priority: true,
      dueDate: true,
      columnId: true,
      labels: { select: { id: true, name: true, color: true } },
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
