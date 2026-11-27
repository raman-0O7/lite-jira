import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { getProjectContext } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id]/context → the brief, every entry and counts (docs/features/27-project-context.md).
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json(await getProjectContext(ctx, id));
});
