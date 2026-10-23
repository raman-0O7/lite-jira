import { NextResponse } from "next/server";

import { ctxForColumn } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createTask } from "@/lib/services/tasks";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/columns/[id]/tasks {title} → append a task to the column.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForColumn(id);
  const task = await createTask(ctx, id, await readJson(request));
  return NextResponse.json({ task }, { status: 201 });
});
