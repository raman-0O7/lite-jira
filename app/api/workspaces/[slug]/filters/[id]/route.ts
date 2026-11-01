import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteSavedFilter, getSavedFilter, updateSavedFilter } from "@/lib/services/filters";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// GET /api/workspaces/[slug]/filters/[id] → {filter} (yours, or shared).
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  return NextResponse.json({ filter: await getSavedFilter(await ctxForWorkspaceSlug(slug), id) });
});

// PATCH /api/workspaces/[slug]/filters/[id] {name?, query?, shared?} (its owner).
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  const filter = await updateSavedFilter(await ctxForWorkspaceSlug(slug), id, await readJson(request));
  return NextResponse.json({ filter });
});

// DELETE /api/workspaces/[slug]/filters/[id] (its owner; admins for shared ones).
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  await deleteSavedFilter(await ctxForWorkspaceSlug(slug), id);
  return NextResponse.json({ success: true });
});
