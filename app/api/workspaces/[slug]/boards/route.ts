import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createBoard, listBoards } from "@/lib/services/boards";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/boards → the workspace's boards with column counts.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ boards: await listBoards(ctx) });
});

// POST /api/workspaces/[slug]/boards {name} → create a board with default columns.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const board = await createBoard(ctx, await readJson(request));
  return NextResponse.json({ board }, { status: 201 });
});
