import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteIssue, getIssue, updateIssue } from "@/lib/services/issues";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/issues/[id] → the full issue.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json({ issue: await getIssue(ctx, id) });
});

// PATCH /api/issues/[id] → update any subset of fields.
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  const issue = await updateIssue(ctx, id, await readJson(request));
  return NextResponse.json({ issue });
});

// DELETE /api/issues/[id] → delete with its sub-issues. The UI confirms first.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  await deleteIssue(ctx, id);
  return NextResponse.json({ success: true });
});
