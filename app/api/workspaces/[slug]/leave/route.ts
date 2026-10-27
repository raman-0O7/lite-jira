import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { leaveWorkspace } from "@/lib/services/members";

type RouteContext = { params: Promise<{ slug: string }> };

// POST /api/workspaces/[slug]/leave → remove the caller from the workspace.
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  await leaveWorkspace(ctx);
  return NextResponse.json({ success: true });
});
