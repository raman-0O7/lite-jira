import { NextResponse } from "next/server";

import { ctxForSprint } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { completeSprint } from "@/lib/services/sprints";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/sprints/[id]/complete {moveOpenTo: "backlog" | "new" | sprintId}
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForSprint(id);
  return NextResponse.json(await completeSprint(ctx, id, await readJson(request)));
});
