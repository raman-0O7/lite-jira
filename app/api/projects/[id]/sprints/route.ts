import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createSprint, listSprints } from "@/lib/services/sprints";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id]/sprints → active, planned, then recent completed sprints with totals.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json({ sprints: await listSprints(ctx, id) });
});

// POST /api/projects/[id]/sprints {name?, goal?} → a planned sprint.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  const sprint = await createSprint(ctx, id, await readJson(request));
  return NextResponse.json({ sprint }, { status: 201 });
});
