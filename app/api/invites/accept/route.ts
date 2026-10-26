import { NextResponse } from "next/server";

import { requireApiUser } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { acceptInvite } from "@/lib/services/invites";

// POST /api/invites/accept {token} → join the workspace; returns its slug.
export const POST = apiRoute(async (request: Request) => {
  const user = await requireApiUser();
  return NextResponse.json(await acceptInvite(user, await readJson(request)));
});
