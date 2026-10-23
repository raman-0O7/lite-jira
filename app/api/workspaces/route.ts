import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { apiRoute } from "@/lib/api/handler";
import { unauthorized } from "@/lib/services/errors";
import { listWorkspacesForUser } from "@/lib/services/workspaces";

// GET /api/workspaces → the workspaces the current user belongs to, with roles.
export const GET = apiRoute(async () => {
  const session = await getSession();
  if (!session) throw unauthorized();
  const workspaces = await listWorkspacesForUser(session.user.id);
  return NextResponse.json({ workspaces });
});
