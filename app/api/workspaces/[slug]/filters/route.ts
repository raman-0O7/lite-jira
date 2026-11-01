import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createSavedFilter, listSavedFilters } from "@/lib/services/filters";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/filters → your saved filters, then teammates' shared ones.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ filters: await listSavedFilters(ctx) });
});

// POST /api/workspaces/[slug]/filters {name, query, shared?} → {filter}.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const filter = await createSavedFilter(ctx, await readJson(request));
  return NextResponse.json({ filter }, { status: 201 });
});
