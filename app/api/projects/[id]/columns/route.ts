import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createColumn } from "@/lib/services/columns";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/projects/[id]/columns {name, category?} → append a column.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  const column = await createColumn(ctx, id, await readJson(request));
  return NextResponse.json({ column }, { status: 201 });
});
