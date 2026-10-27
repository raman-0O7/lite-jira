import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { setMemberProjects } from "@/lib/services/members";

type RouteContext = { params: Promise<{ slug: string; userId: string }> };

// PUT /api/workspaces/[slug]/members/[userId]/projects {projectIds} → a guest's projects.
export const PUT = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { slug, userId } = await params;
  const ctx = await ctxForWorkspaceSlug(slug);
  const member = await setMemberProjects(ctx, userId, await readJson(request));
  return NextResponse.json({ member });
});
