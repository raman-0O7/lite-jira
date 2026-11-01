import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { addIssueLink, listIssueLinks } from "@/lib/services/links";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/issues/[id]/links → links as they read from this issue.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  return NextResponse.json({ links: await listIssueLinks(await ctxForIssue(id), id) });
});

// POST /api/issues/[id]/links {relation, target} → {link}.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const link = await addIssueLink(await ctxForIssue(id), id, await readJson(request));
  return NextResponse.json({ link }, { status: 201 });
});
