import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { getAi, updateAiSettings } from "@/lib/services/ai";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/ai → whether in-app AI is on (everyone); its settings (admins).
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json(await getAi(ctx));
});

// PUT /api/workspaces/[slug]/ai {apiKey?, useAgentKey?, model?, enabled?} → admins change the settings.
export const PUT = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json(await updateAiSettings(ctx, await readJson(request)));
});
