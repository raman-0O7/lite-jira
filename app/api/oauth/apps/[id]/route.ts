import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { disconnectApp } from "@/lib/services/oauth-apps";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/oauth/apps/[id] → disconnect an app (revokes its consent and tokens).
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const user = await requireApiUser();
  await disconnectApp(user.id, (await params).id);
  return NextResponse.json({ success: true });
});
