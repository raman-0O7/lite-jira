import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { saveBrief } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string }> };

// PUT /api/projects/[id]/context/brief {body, version} → the saved brief; a stale version is a 409.
export const PUT = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json({ brief: await saveBrief(ctx, id, await readJson(request)) });
});
