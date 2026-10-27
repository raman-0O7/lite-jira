import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { connectRepo } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string }> };

// POST /api/workspaces/[slug]/github/repos {installationId, repoFullName, projectId, toggles?} → connection.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ repo: await connectRepo(ctx, await readJson(request)) }, { status: 201 });
});
