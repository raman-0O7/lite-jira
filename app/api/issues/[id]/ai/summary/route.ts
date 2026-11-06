import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { summarizeIssue } from "@/lib/services/ai";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/issues/[id]/ai/summary → a summary of the issue and its comments.
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json(await summarizeIssue(ctx, id));
});
