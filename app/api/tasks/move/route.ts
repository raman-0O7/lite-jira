import { NextResponse } from "next/server";

import {
  findOwnedColumn,
  findOwnedTask,
  getApiUser,
} from "@/lib/api/ownership";
import { planMove } from "@/lib/board-dnd";
import { db } from "@/lib/db";
import { moveTaskSchema } from "@/lib/validations/task";

// PATCH /api/tasks/move {taskId, toColumnId, toPosition}
//
// Repositions a task within or across columns. The whole operation runs in one
// $transaction so positions can never be left half-rewritten / colliding.
//
// Authoritative algorithm (Feature 03):
//  1. Verify the task, its source column, and the target column all belong to
//     the session user (else 404 — never leak existence).
//  2. Load the target column's tasks ordered by position, EXCLUDING the moved
//     task.
//  3. Insert the moved task at `toPosition` (clamped to [0, len]) — see
//     `planMove` / `clampPosition` in lib/board-dnd.ts.
//  4. Reassign `position = index` across the target column; if the source
//     differs, also reindex the source column to 0..n-1.
//  5. Persist the task's new `columnId` + every affected position.
export async function PATCH(request: Request) {
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

  const parsed = moveTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { taskId, toColumnId, toPosition } = parsed.data;

  // (1) Ownership: task → its column → board → user, and target column → user.
  const task = await findOwnedTask(taskId, user.id);
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  const targetColumn = await findOwnedColumn(toColumnId, user.id);
  if (!targetColumn) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  const sourceColumnId = task.columnId;
  const sameColumn = sourceColumnId === toColumnId;

  await db.$transaction(async (tx) => {
    // (2) Target siblings, ordered by position, EXCLUDING the moved task.
    const targetSiblings = await tx.task.findMany({
      where: { columnId: toColumnId, id: { not: taskId } },
      orderBy: { position: "asc" },
      select: { id: true },
    });

    // Source siblings (only needed for a cross-column move).
    const sourceSiblings = sameColumn
      ? targetSiblings
      : await tx.task.findMany({
          where: { columnId: sourceColumnId, id: { not: taskId } },
          orderBy: { position: "asc" },
          select: { id: true },
        });

    // (3)+(4) Plan the contiguous reindex of the affected column(s).
    const plan = planMove({
      taskId,
      sameColumn,
      sourceSiblings,
      targetSiblings,
      toPosition,
    });

    // (5) Persist. Move the task (new column + position) first, then rewrite
    // every sibling position so the column is 0..n-1 contiguous.
    const targetPosition = plan.target.indexOf(taskId);
    await tx.task.update({
      where: { id: taskId },
      data: { columnId: toColumnId, position: targetPosition },
    });

    await Promise.all(
      plan.target.map((id, index) =>
        id === taskId
          ? null
          : tx.task.update({ where: { id }, data: { position: index } }),
      ),
    );

    if (plan.source) {
      await Promise.all(
        plan.source.map((id, index) =>
          tx.task.update({ where: { id }, data: { position: index } }),
        ),
      );
    }
  });

  return NextResponse.json({ success: true });
}
