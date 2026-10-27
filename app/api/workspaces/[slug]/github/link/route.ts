import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { startGitHubLink, unlinkGitHub } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string }> };

// POST /api/workspaces/[slug]/github/link → {url} to authorize on GitHub.
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ url: startGitHubLink(ctx) });
});

// DELETE /api/workspaces/[slug]/github/link → unlink your GitHub account.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  await unlinkGitHub(ctx);
  return NextResponse.json({ success: true });
});
