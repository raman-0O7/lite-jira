import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { listIssueActivity } from "@/lib/services/activity";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/issues/[id]/activity → {entries (oldest first), refs (names they mention)}.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json(await listIssueActivity(ctx, id));
});
