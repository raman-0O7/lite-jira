import { NextResponse } from "next/server";

import { ctxForBoard } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteBoard, getBoardDetail, renameBoard } from "@/lib/services/boards";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/boards/[id] → the board with its ordered columns and their tasks.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForBoard(id);
  return NextResponse.json({ board: await getBoardDetail(ctx, id) });
});

// PATCH /api/boards/[id] {name} → rename.
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForBoard(id);
  const board = await renameBoard(ctx, id, await readJson(request));
  return NextResponse.json({ board });
});

// DELETE /api/boards/[id] → delete with its columns, tasks, and labels.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForBoard(id);
  await deleteBoard(ctx, id);
  return NextResponse.json({ success: true });
});
