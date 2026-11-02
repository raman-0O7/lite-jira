import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getBacklog } from "@/lib/services/sprints";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id]/backlog → active and planned sprints with their issues, then the backlog.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json(await getBacklog(ctx, id));
});
