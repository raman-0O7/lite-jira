import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteWorkspace, updateWorkspace } from "@/lib/services/workspaces";

type RouteContext = { params: Promise<{ slug: string }> };

// PATCH /api/workspaces/[slug] {name} → rename (owners and admins).
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const workspace = await updateWorkspace(ctx, await readJson(request));
  return NextResponse.json({ workspace });
});

// DELETE /api/workspaces/[slug] → delete with everything in it (owners; not personal).
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  await deleteWorkspace(ctx);
  return NextResponse.json({ success: true });
});
