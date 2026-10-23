import { NextResponse } from "next/server";

import { ctxForBoard } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createLabel, listLabels } from "@/lib/services/labels";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/boards/[id]/labels → the board's labels.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForBoard(id);
  return NextResponse.json({ labels: await listLabels(ctx, id) });
});

// POST /api/boards/[id]/labels {name, color} → create a label on the board.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForBoard(id);
  const label = await createLabel(ctx, id, await readJson(request));
  return NextResponse.json({ label }, { status: 201 });
});
