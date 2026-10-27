import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { listMembers } from "@/lib/services/members";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/members → members with roles (and guests' projects for admins).
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ members: await listMembers(ctx) });
});
