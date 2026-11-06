import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { breakDownIssue } from "@/lib/services/ai";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/issues/[id]/ai/breakdown → suggested sub-issues (nothing is created).
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json(await breakDownIssue(ctx, id));
});
