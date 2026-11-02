import { NextResponse } from "next/server";

import { ctxForSprint } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { startSprint } from "@/lib/services/sprints";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/sprints/[id]/start {endDate, startDate?, name?, goal?}
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForSprint(id);
  return NextResponse.json({ sprint: await startSprint(ctx, id, await readJson(request)) });
});
