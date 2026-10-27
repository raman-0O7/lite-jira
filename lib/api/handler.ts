import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { badRequest, ServiceError } from "@/lib/services/errors";

/**
 * Route-handler plumbing shared by every app/api route.
 *
 * Handlers stay thin: resolve a Ctx (lib/api/context.ts), call a service, return
 * JSON. Errors thrown anywhere in that chain are mapped here to the API's
 * `{ error: string }` shape with the right status.
 */

export function errorResponse(error: unknown) {
  if (error instanceof ServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  console.error(error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

/** Wrap a route handler so thrown service/validation errors become JSON responses. */
export function apiRoute<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/** Parse the request body as JSON, or throw a 400. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw badRequest("Invalid JSON body");
  }
}
