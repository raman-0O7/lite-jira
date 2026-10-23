import { NextResponse } from "next/server";

import { ctxForBoard } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { reorderColumns } from "@/lib/services/columns";
import { reorderColumnsSchema } from "@/lib/validations/column";

// PATCH /api/columns/reorder {boardId, orderedIds} → rewrite column positions.
export const PATCH = apiRoute(async (request: Request) => {
  const body = reorderColumnsSchema.parse(await readJson(request));
  const ctx = await ctxForBoard(body.boardId);
  await reorderColumns(ctx, body);
  return NextResponse.json({ success: true });
});
