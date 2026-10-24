import { NextResponse } from "next/server";

import { ctxForProject } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { reorderColumns } from "@/lib/services/columns";
import { reorderColumnsSchema } from "@/lib/validations/column";

// PATCH /api/columns/reorder {projectId, orderedIds} → rewrite column positions.
export const PATCH = apiRoute(async (request: Request) => {
  const body = reorderColumnsSchema.parse(await readJson(request));
  const ctx = await ctxForProject(body.projectId);
  await reorderColumns(ctx, body);
  return NextResponse.json({ success: true });
});
