import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { completeGitHubAppSetup } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string }> };

// POST /api/workspaces/[slug]/github/app/complete {code, state} → the new app's env values, once.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const result = await completeGitHubAppSetup(ctx, await readJson(request));
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
});
