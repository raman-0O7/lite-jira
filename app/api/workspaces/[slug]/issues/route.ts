import { type NextRequest, NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { searchIssues } from "@/lib/services/search";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/issues?q=… → issues matching the query language.
export const GET = apiRoute(async (request: NextRequest, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const query = request.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ issues: await searchIssues(ctx, query) });
});
