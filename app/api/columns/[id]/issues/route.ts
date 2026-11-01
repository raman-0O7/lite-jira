import { NextResponse } from "next/server";

import { ctxForColumn } from "@/lib/api/context";
import { apiRoute, readJson } from "@/lib/api/handler";
import { readImages } from "@/lib/attachments";
import { badRequest } from "@/lib/services/errors";
import { createIssue } from "@/lib/services/issues";

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/columns/[id]/issues {title, type?} → append an issue to the column.
// As multipart form data (fields + up to 3 "image" files) it carries images.
export const POST = apiRoute(async (request: Request, { params }: RouteContext) => {
  const { id } = await params;
  const ctx = await ctxForColumn(id);
  if (!(request.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    return NextResponse.json({ issue: await createIssue(ctx, id, await readJson(request)) }, { status: 201 });
  }
  const form = await request.formData().catch(() => {
    throw badRequest("Invalid form data");
  });
  const images = await readImages(form.getAll("image").filter((value): value is File => value instanceof File));
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" && value !== "" ? value : undefined;
  };
  const issue = await createIssue(
    ctx,
    id,
    {
      title: text("title"),
      type: text("type"),
      priority: text("priority"),
      description: text("description"),
      assigneeUserId: text("assigneeUserId"),
    },
    images,
  );
  return NextResponse.json({ issue }, { status: 201 });
});
