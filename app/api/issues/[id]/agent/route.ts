import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { assignAgent } from "@/lib/services/agents";
import { getIssue } from "@/lib/services/issues";

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/issues/[id]/agent {agentId | null} → assign to an agent (dispatches) or clear; returns the issue.
export const PUT = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  await assignAgent(ctx, id, await readJson(request));
  return NextResponse.json({ issue: await getIssue(ctx, id) });
});
