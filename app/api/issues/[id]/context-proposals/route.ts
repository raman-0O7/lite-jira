import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { listIssueProposals } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/issues/[id]/context-proposals → context proposals waiting for review from this issue.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  return NextResponse.json({ proposals: await listIssueProposals(ctx, id) });
});
