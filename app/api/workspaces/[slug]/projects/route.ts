import { NextResponse } from "next/server";

import { ctxForWorkspaceSlug } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createProject, listProjects } from "@/lib/services/projects";

type RouteContext = { params: Promise<{ slug: string }> };

// GET /api/workspaces/[slug]/projects → the workspace's projects.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  return NextResponse.json({ projects: await listProjects(ctx) });
});

// POST /api/workspaces/[slug]/projects {name, key?} → create with default columns.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const ctx = await ctxForWorkspaceSlug((await params).slug);
  const project = await createProject(ctx, await readJson(request));
  return NextResponse.json({ project }, { status: 201 });
});
