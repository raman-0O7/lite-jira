import { NextResponse } from "next/server";

import { findOwnedLabel, getApiUser } from "@/lib/api/ownership";
import { db } from "@/lib/db";
import { updateLabelSchema } from "@/lib/validations/label";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/labels/[id] {name?, color?} → update a label.
// Ownership is resolved label → board → user; foreign labels return 404.
export async function PATCH(request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedLabel(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateLabelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const { name, color } = parsed.data;
  const data: { name?: string; color?: string } = {};
  if (name !== undefined) data.name = name;
  if (color !== undefined) data.color = color;

  const label = await db.label.update({
    where: { id },
    data,
    select: { id: true, name: true, color: true },
  });

  return NextResponse.json({ label });
}

// DELETE /api/labels/[id] → delete a label (also detaches it from any tasks).
export async function DELETE(_request: Request, { params }: RouteContext) {
  const user = await getApiUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const owned = await findOwnedLabel(id, user.id);
  if (!owned) {
    return NextResponse.json({ error: "Label not found" }, { status: 404 });
  }

  await db.label.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
