import { NextResponse } from "next/server";

import { ctxForIssue } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { moveIssue } from "@/lib/services/issues";
import { moveIssueSchema } from "@/lib/validations/issue";

// PATCH /api/issues/move {issueId, toColumnId, toPosition} → reposition an issue.
export const PATCH = apiRoute(async (request: Request) => {
  const body = moveIssueSchema.parse(await readJson(request));
  const ctx = await ctxForIssue(body.issueId);
  await moveIssue(ctx, body);
  return NextResponse.json({ success: true });
});
