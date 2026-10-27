import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteAgent, updateAgent } from "@/lib/services/agents";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// PATCH /api/workspaces/[slug]/agents/[id] {name?, enabled?, fireUrl?, token?, webhookUrl?} (admins).
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  const agent = await updateAgent(await ctxForWorkspaceSlug(slug), id, await readJson(request));
  return NextResponse.json({ agent });
});

// DELETE /api/workspaces/[slug]/agents/[id] (admins).
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  await deleteAgent(await ctxForWorkspaceSlug(slug), id);
  return NextResponse.json({ success: true });
});
