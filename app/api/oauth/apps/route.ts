import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { listConnectedApps } from "@/lib/services/oauth-apps";

// GET /api/oauth/apps → apps (MCP/OAuth clients) the current user has allowed.
export const GET = apiRoute(async () => {
  const user = await requireApiUser();
  return NextResponse.json({ apps: await listConnectedApps(user.id) });
});
