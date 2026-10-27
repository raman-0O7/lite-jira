import { NextResponse } from "next/server";

import { ctxForColumn } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteColumn, updateColumn } from "@/lib/services/columns";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/columns/[id] {name?, category?} → rename / recategorize.
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForColumn(id);
  const column = await updateColumn(ctx, id, await readJson(request));
  return NextResponse.json({ column });
});

// DELETE /api/columns/[id] → delete with its issues. The UI warns first.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForColumn(id);
  await deleteColumn(ctx, id);
  return NextResponse.json({ success: true });
});
