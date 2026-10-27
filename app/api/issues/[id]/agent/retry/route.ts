import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { retryAgentRun } from "@/lib/services/agents";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/issues/[id]/agent/retry → start a new run for the assigned agent.
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  return NextResponse.json(await retryAgentRun(await ctxForIssue(id), id));
});
