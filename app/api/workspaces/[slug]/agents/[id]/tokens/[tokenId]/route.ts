import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { revokeAgentToken } from "@/lib/services/agents";

type RouteContext = { params: Promise<{ slug: string; id: string; tokenId: string }> };

// DELETE /api/workspaces/[slug]/agents/[id]/tokens/[tokenId] → revoke (admins).
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id, tokenId } = await params;
  await revokeAgentToken(await ctxForWorkspaceSlug(slug), id, tokenId);
  return NextResponse.json({ success: true });
});
