import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getGitHubSettings } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/github → configured?, your link, installations with connected repos.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json(await getGitHubSettings(ctx));
});
