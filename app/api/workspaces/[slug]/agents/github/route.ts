import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getWorkspaceAgentGitHub } from "@/lib/services/agents";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/agents/github → whether Kanso's GitHub App can push for the workspace agent (admins).
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ github: await getWorkspaceAgentGitHub(ctx) });
});
