import { NextResponse } from "next/server";

import { ctxForColumn } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { createIssue } from "@/lib/services/issues";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/columns/[id]/issues {title, type?} → append an issue to the column.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForColumn(id);
  const issue = await createIssue(ctx, id, await readJson(request));
  return NextResponse.json({ issue }, { status: 201 });
});
