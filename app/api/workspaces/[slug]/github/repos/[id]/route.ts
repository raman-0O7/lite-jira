import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { disconnectRepo, updateProjectRepo } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// PATCH /api/workspaces/[slug]/github/repos/[id] {importIssues?, statusSync?, moveOnMerge?}
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  const repo = await updateProjectRepo(await ctxForWorkspaceSlug(slug), id, await readJson(request));
  return NextResponse.json({ repo });
});

// DELETE /api/workspaces/[slug]/github/repos/[id] → disconnect the repository.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  await disconnectRepo(await ctxForWorkspaceSlug(slug), id);
  return NextResponse.json({ success: true });
});
