import { NextResponse } from "next/server";

import { ctxForLabel } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteLabel, updateLabel } from "@/lib/services/labels";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/labels/[id] {name?, color?} → update a label.
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForLabel(id);
  const label = await updateLabel(ctx, id, await readJson(request));
  return NextResponse.json({ label });
});

// DELETE /api/labels/[id] → delete a label and detach it from tasks.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForLabel(id);
  await deleteLabel(ctx, id);
  return NextResponse.json({ success: true });
});
