import { NextResponse } from "next/server";

import { ctxForTask } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { deleteTask, getTask, updateTask } from "@/lib/services/tasks";

type RouteContext = { params: Promise<{ id: string }> };

// GET /api/tasks/[id] → the full task.
export const GET = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForTask(id);
  return NextResponse.json({ task: await getTask(ctx, id) });
});

// PATCH /api/tasks/[id] {title?, description?, priority?, dueDate?, labelIds?}.
export const PATCH = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForTask(id);
  const task = await updateTask(ctx, id, await readJson(request));
  return NextResponse.json({ task });
});

// DELETE /api/tasks/[id]. The UI confirms first.
export const DELETE = apiRoute(async (_request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForTask(id);
  await deleteTask(ctx, id);
  return NextResponse.json({ success: true });
});
