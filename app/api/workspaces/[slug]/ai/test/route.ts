import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { testAiSettings } from "@/lib/services/ai";

type RouteContext = { params: Promise<{ slug: string }> };

// POST /api/workspaces/[slug]/ai/test {provider?, apiKey?, model?, baseUrl?, structuredOutputs?}
// → admins check a provider, key and model with one tiny request; nothing is saved.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json(await testAiSettings(ctx, await readJson(request)));
});
