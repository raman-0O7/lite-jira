import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getMyWork } from "@/lib/services/my-work";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/my-work → {needsYou, inProgress, todo, doneThisWeek, created}.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json(await getMyWork(ctx));
});
