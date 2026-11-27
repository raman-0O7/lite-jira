import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { issueOverlaps } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/issues/[id]/overlaps → other active work changing the same files.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json({ overlaps: await issueOverlaps(ctx, id) });
});
