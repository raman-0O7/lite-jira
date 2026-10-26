import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createInvite, listInvites } from "@/lib/services/invites";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/invites → pending invites (owners and admins).
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ invites: await listInvites(ctx) });
});

// POST /api/workspaces/[slug]/invites {email?, role, projectIds?} → {invite, url, emailSent}.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const result = await createInvite(ctx, await readJson(request));
  return NextResponse.json(result, { status: 201 });
});
