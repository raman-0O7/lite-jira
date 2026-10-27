import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { removeInstallation } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// DELETE /api/workspaces/[slug]/github/installations/[id] → forget an installation (admins).
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  await removeInstallation(await ctxForWorkspaceSlug(slug), id);
  return NextResponse.json({ success: true });
});
