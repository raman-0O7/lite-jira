import { NextResponse } from "next/server";

import { ctxForContextEntry } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { decideEntry } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH /api/context-entries/[id] {action: accept|reject|archive, text?, replacesId?}
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForContextEntry(id);
  return NextResponse.json({ entry: await decideEntry(ctx, id, await readJson(request)) });
});
