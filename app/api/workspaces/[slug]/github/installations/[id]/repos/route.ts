import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { listInstallationRepos } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// GET /api/workspaces/[slug]/github/installations/[id]/repos → repositories the installation can access.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  return NextResponse.json({ repos: await listInstallationRepos(await ctxForWorkspaceSlug(slug), id) });
});
