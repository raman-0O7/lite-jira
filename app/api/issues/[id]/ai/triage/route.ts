import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { triageIssue } from "@/lib/services/ai";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/issues/[id]/ai/triage → suggested type, priority, labels and estimate (nothing is changed).
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json(await triageIssue(ctx, id));
});
