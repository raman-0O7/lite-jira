import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { removeMember, updateMemberRole } from "@/lib/services/members";

type RouteContext = { params: Promise<{ slug: string; userId: string }> };

// PATCH /api/workspaces/[slug]/members/[userId] {role} → change a member's role.
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { slug, userId } = await params;
  const ctx = await ctxForWorkspaceSlug(slug);
  const member = await updateMemberRole(ctx, userId, await readJson(request));
  return NextResponse.json({ member });
});

// DELETE /api/workspaces/[slug]/members/[userId] → remove someone from the workspace.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, userId } = await params;
  const ctx = await ctxForWorkspaceSlug(slug);
  await removeMember(ctx, userId);
  return NextResponse.json({ success: true });
});
