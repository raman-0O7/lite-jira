import { NextResponse } from "next/server";

import { findOwnedColumn, getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { updateColumnSchema } from "@/lib/validations/column";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/columns/[id] {name} → rename.
export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedColumn(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateColumnSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const column = await db.column.update({
    where: { id },
    data: { name: parsed.data.name },
    select: { id: true, name: true, position: true },
  });

  return NextResponse.json({ column });
}

// DELETE /api/columns/[id] → delete (Prisma cascade removes its tasks).
// The UI warns before calling this.
export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedColumn(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Column not found" }, { status: 404 });
  }

  await db.column.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
