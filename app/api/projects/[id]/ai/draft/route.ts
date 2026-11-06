import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { draftIssue } from "@/lib/services/ai";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/projects/[id]/ai/draft {text} → suggested fields for a new issue (nothing is created).
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json(await draftIssue(ctx, id, await readJson(request)));
});
