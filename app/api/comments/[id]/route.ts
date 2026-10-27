import { NextResponse } from "next/server";

import { ctxForComment } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteComment, editComment } from "@/lib/services/comments";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/comments/[id] {body} → edit (author only).
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForComment(id);
  const comment = await editComment(ctx, id, await readJson(request));
  return NextResponse.json({ comment });
});

// DELETE /api/comments/[id] → delete (author or admin).
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForComment(id);
  await deleteComment(ctx, id);
  return NextResponse.json({ success: true });
});
