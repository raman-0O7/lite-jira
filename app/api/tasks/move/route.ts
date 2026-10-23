import { NextResponse } from "next/server";

import { ctxForTask } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { moveTask } from "@/lib/services/tasks";
import { moveTaskSchema } from "@/lib/validations/task";

// PATCH /api/tasks/move {taskId, toColumnId, toPosition} → reposition a task.
export const PATCH = apiRoute(async (request: Request) => {
  const body = moveTaskSchema.parse(await readJson(request));
  const ctx = await ctxForTask(body.taskId);
  await moveTask(ctx, body);
  return NextResponse.json({ success: true });
});
