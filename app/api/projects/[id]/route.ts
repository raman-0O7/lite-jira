import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import {
  deleteProject,
  getProjectDetail,
  updateProject,
} from "@/lib/services/projects";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/projects/[id] → the project with its ordered columns and issue cards.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json({ project: await getProjectDetail(ctx, id) });
});

// PATCH /api/projects/[id] {name?, mode?} → update. The key is immutable.
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  const project = await updateProject(ctx, id, await readJson(request));
  return NextResponse.json({ project });
});

// DELETE /api/projects/[id] → delete with its columns, issues, and labels.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  await deleteProject(ctx, id);
  return NextResponse.json({ success: true });
});
