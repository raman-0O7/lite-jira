import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { createAgentToken, listAgentTokens } from "@/lib/services/agents";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// GET /api/workspaces/[slug]/agents/[id]/tokens → the agent's active tokens (admins).
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  return NextResponse.json({ tokens: await listAgentTokens(await ctxForWorkspaceSlug(slug), id) });
});

// POST /api/workspaces/[slug]/agents/[id]/tokens → {token, secret} (secret shown once; admins).
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  const result = await createAgentToken(await ctxForWorkspaceSlug(slug), id);
  return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
});
