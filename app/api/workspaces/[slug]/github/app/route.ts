import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { startGitHubAppSetup } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string }> };

// POST /api/workspaces/[slug]/github/app {name, org?, public} → {action, manifest} to post to GitHub.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { slug } = await params;
  const ctx = await ctxForWorkspaceSlug(slug);
  return NextResponse.json(await startGitHubAppSetup(ctx, slug, await readJson(request)));
});
