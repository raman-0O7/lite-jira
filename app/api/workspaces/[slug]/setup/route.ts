import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { MCP_RESOURCE } from "@/lib/mcp/config";
import { getSetupStatus } from "@/lib/services/setup";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/setup → which setup steps the caller has done here,
// plus the MCP server URL the setup steps ask them to paste.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ status: await getSetupStatus(ctx), mcpUrl: MCP_RESOURCE });
});
