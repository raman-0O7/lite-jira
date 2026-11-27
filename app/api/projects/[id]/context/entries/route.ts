import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { addEntry } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/projects/[id]/context/entries {kind, text, issueId?, replacesId?} → an accepted entry.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForProject(id);
  return NextResponse.json({ entry: await addEntry(ctx, id, await readJson(request)) }, { status: 201 });
});
