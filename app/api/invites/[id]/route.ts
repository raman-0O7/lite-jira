import { NextResponse } from "next/server";

import { ctxForInvite } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { revokeInvite } from "@/lib/services/invites";

type RouteContext = { params: Promise<{ id: string }> };

// DELETE /api/invites/[id] → revoke a pending invite.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForInvite(id);
  await revokeInvite(ctx, id);
  return NextResponse.json({ success: true });
});
