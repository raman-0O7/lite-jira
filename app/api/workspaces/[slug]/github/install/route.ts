import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { startGitHubInstall } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string }> };

// POST /api/workspaces/[slug]/github/install → {url} to send an admin to GitHub.
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ url: startGitHubInstall(ctx) });
});
