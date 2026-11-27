import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { badRequest } from "@/lib/services/errors";
import { restoreBriefRevision } from "@/lib/services/project-context";

type RouteContext = { params: Promise<{ id: string; version: string }> };

// POST /api/projects/[id]/context/brief/revisions/[version]/restore → saved as a new version.
export const POST = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id, version } = await params;
  const number = Number(version);
  if (!Number.isInteger(number) || number < 1) throw badRequest("That isn't a version number");
  const ctx = await ctxForProject(id);
  return NextResponse.json({ brief: await restoreBriefRevision(ctx, id, number) });
});
