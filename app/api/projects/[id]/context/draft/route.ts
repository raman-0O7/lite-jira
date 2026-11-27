import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { draftBrief } from "@/lib/services/ai";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/projects/[id]/context/draft → { brief }: a suggested brief; nothing is saved.
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json(await draftBrief(ctx, id));
});
