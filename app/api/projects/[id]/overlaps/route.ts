import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { projectOverlaps } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id]/overlaps → { overlaps: { [issueId]: Overlap[] } } for the board's chips.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json({ overlaps: await projectOverlaps(ctx, id) });
});
