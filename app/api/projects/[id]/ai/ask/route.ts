import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { askProject } from "@/lib/services/ai";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/projects/[id]/ai/ask {question} → an answer from the project's issues.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json(await askProject(ctx, id, await readJson(request)));
});
