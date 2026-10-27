import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createAgent, listAgents } from "@/lib/services/agents";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/agents → the workspace's agents (no secrets).
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ agents: await listAgents(ctx) });
});

// POST /api/workspaces/[slug]/agents {kind, name, …config} → {agent, secrets} (secrets shown once; admins).
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const result = await createAgent(ctx, await readJson(request));
  return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
});
