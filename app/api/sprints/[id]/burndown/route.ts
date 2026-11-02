import { NextResponse } from "next/server";

import { ctxForSprint } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getBurndown } from "@/lib/services/sprints";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/sprints/[id]/burndown → remaining work per day, rebuilt from history.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForSprint(id);
  return NextResponse.json(await getBurndown(ctx, id));
});
