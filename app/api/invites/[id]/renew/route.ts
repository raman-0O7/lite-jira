import { NextResponse } from "next/server";

import { ctxForInvite } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { renewInvite } from "@/lib/services/invites";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/invites/[id]/renew → a fresh link and expiry; the old link stops working.
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForInvite(id);
  return NextResponse.json(await renewInvite(ctx, id));
});
