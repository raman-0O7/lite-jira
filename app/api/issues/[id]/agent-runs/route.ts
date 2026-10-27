import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { listAgentRuns } from "@/lib/services/agents";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/issues/[id]/agent-runs → the issue's recent agent runs, newest first.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  return NextResponse.json({ runs: await listAgentRuns(await ctxForIssue(id), id) });
});
