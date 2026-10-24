import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createSubIssue } from "@/lib/services/issues";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/issues/[id]/subissues {title} → create a sub-issue under this issue.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForIssue(id);
  const issue = await createSubIssue(ctx, id, await readJson(request));
  return NextResponse.json({ issue }, { status: 201 });
});
