import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { readImages } from "@/lib/attachments";
import { addComment, listComments } from "@/lib/services/comments";
import { badRequest } from "@/lib/services/errors";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/issues/[id]/comments → oldest first.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json({ comments: await listComments(ctx, id) });
});

// POST /api/issues/[id]/comments {body} → add a comment. As multipart form
// data (body + up to 3 "image" files) it carries images.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    return NextResponse.json({ comment: await addComment(ctx, id, await readJson(request)) }, { status: 201 });
  }
  const form = await request.formData().catch(() => {
    throw badRequest("Invalid form data");
  });
  const files = form.getAll("image").filter((value): value is File => value instanceof File);
  const images = await readImages(files);
  const comment = await addComment(ctx, id, { body: form.get("body") ?? "" }, images);
  return NextResponse.json({ comment }, { status: 201 });
});
