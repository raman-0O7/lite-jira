import { NextResponse } from "next/server";

import { ctxForSprint } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteSprint, updateSprint } from "@/lib/services/sprints";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/sprints/[id] {name?, goal?, startDate?, endDate?}
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForSprint(id);
  return NextResponse.json({ sprint: await updateSprint(ctx, id, await readJson(request)) });
});

// DELETE /api/sprints/[id] → planned sprints only; issues return to the backlog.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForSprint(id);
  await deleteSprint(ctx, id);
  return new NextResponse(null, { status: 204 });
});
