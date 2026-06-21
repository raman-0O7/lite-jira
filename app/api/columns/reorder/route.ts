import { NextResponse } from "next/server";

import { findOwnedBoard, getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { reorderColumnsSchema } from "@/lib/validations/column";

// PATCH /api/columns/reorder {boardId, orderedIds} → rewrite positions.
//
// Reindex strategy (PLAN §7): we rewrite every position from the supplied
// order so positions stay 0..n-1 contiguous. The whole rewrite runs in one
// transaction so a partial failure can't leave columns half-reordered.
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

  const parsed = reorderColumnsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { boardId, orderedIds } = parsed.data;

  const owned = await findOwnedBoard(boardId, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Board not found" }, { status: 404 });
  }

  // The supplied ids must be exactly the board's current columns — no more,
  // no fewer, no foreign ids. This blocks reordering with stolen/stale ids.
  const columns = await db.column.findMany({
    where: { boardId },
    select: { id: true },
  });
  const existing = new Set(columns.map((c) => c.id));
  const supplied = new Set(orderedIds);
  const mismatch =
    existing.size !== supplied.size ||
    orderedIds.some((id) => !existing.has(id));
  if (mismatch) {
    return NextResponse.json(
      { error: "orderedIds must match the board's columns exactly" },
      { status: 400 },
    );
  }

  await db.$transaction(
    orderedIds.map((id, position) =>
      db.column.update({ where: { id }, data: { position } }),
    ),
  );

  return NextResponse.json({ success: true });
}
