import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getVelocity } from "@/lib/services/sprints";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id]/velocity → committed vs completed for recent completed sprints.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json(await getVelocity(ctx, id));
});
