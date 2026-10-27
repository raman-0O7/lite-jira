import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createApiToken, listApiTokens } from "@/lib/services/api-tokens";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/tokens → the caller's own API tokens here.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ tokens: await listApiTokens(ctx) });
});

// POST /api/workspaces/[slug]/tokens {name, access, projectIds?, expiresInDays} → {token, secret} (secret shown once).
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const result = await createApiToken(ctx, await readJson(request));
  return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
});
