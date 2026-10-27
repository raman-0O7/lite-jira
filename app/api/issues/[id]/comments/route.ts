import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { addComment, listComments } from "@/lib/services/comments";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/issues/[id]/comments → oldest first.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json({ comments: await listComments(ctx, id) });
});

// POST /api/issues/[id]/comments {body} → add a comment.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  const comment = await addComment(ctx, id, await readJson(request));
  return NextResponse.json({ comment }, { status: 201 });
});
