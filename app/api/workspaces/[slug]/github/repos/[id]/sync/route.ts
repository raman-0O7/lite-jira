import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { syncProjectRepo } from "@/lib/services/github";

type RouteContext = { params: Promise<{ slug: string; id: string }> };

// POST /api/workspaces/[slug]/github/repos/[id]/sync → {imported}
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { slug, id } = await params;
  return NextResponse.json(await syncProjectRepo(await ctxForWorkspaceSlug(slug), id));
});
