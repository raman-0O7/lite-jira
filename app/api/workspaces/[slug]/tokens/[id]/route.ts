import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { revokeApiToken } from "@/lib/services/api-tokens";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// DELETE /api/workspaces/[slug]/tokens/[id] → revoke one of the caller's tokens.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  const ctx = await ctxForWorkspaceSlug(slug);
  await revokeApiToken(ctx, id);
  return NextResponse.json({ success: true });
});
