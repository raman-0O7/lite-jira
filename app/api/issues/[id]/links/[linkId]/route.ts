import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute } from "@/lib/api/handler";
import { removeIssueLink } from "@/lib/services/links";

type RouteContext = { params: Promise<{ id: string; linkId: string }> };

// DELETE /api/issues/[id]/links/[linkId] → removes the link (from either side).
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id, linkId } = await params;
  await removeIssueLink(await ctxForIssue(id), id, linkId);
  return NextResponse.json({ success: true });
});
