import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createLabel, listLabels } from "@/lib/services/labels";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id]/labels → the project's labels.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json({ labels: await listLabels(ctx, id) });
});

// POST /api/projects/[id]/labels {name, color} → create a label.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  const label = await createLabel(ctx, id, await readJson(request));
  return NextResponse.json({ label }, { status: 201 });
});
