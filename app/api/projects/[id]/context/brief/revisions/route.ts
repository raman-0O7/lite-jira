import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { listBriefRevisions } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id]/context/brief/revisions → saved versions, newest first.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json({ revisions: await listBriefRevisions(ctx, id) });
});
