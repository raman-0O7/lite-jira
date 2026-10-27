import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getIssueByKey } from "@/lib/services/issues";

type RouteContext = { params: Promise<{ slug: string; key: string }> };

// GET /api/workspaces/[slug]/issues/[key] → the issue with key WEB-42.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, key } = await params;
  const ctx = await ctxForWorkspaceSlug(slug);
  return NextResponse.json({ issue: await getIssueByKey(ctx, key) });
});
