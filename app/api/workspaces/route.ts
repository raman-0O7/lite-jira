import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createWorkspace, listWorkspacesForUser } from "@/lib/services/workspaces";

// GET /api/workspaces → the workspaces the current user belongs to, with roles.
export const GET = apiRoute(async () => {
  const user = await requireApiUser();
  const workspaces = await listWorkspacesForUser(user.id);
  return NextResponse.json({ workspaces });
});

// POST /api/workspaces {name, slug?} → create a team workspace owned by the caller.
export const POST = apiRoute(async (request: Request) => {
  const user = await requireApiUser();
  const workspace = await createWorkspace(user.id, await readJson(request));
  return NextResponse.json({ workspace }, { status: 201 });
});
