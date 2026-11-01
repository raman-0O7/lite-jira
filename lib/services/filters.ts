import { Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { authorize, can } from "@/lib/permissions";
import { parseIssueQuery, QueryError } from "@/lib/query/issue-query";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { badRequest, forbidden, notFound, ServiceError } from "@/lib/services/errors";

/**
 * Saved filters (docs/features/22-my-work.md "Saved filters"): a named query
 * in the query language, personal or shared with the workspace. Results
 * always run as the viewer, so sharing a filter never shares issues.
 */

const filterSelect = {
  id: true,
  name: true,
  query: true,
  shared: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, name: true, image: true } },
} satisfies Prisma.SavedFilterSelect;

const name = z.string().trim().min(1, "Name the filter").max(60);
const query = z
  .string()
  .trim()
  .min(1, "Enter a query")
  .max(1000)
  .superRefine((value, issue) => {
    try {
      parseIssueQuery(value);
    } catch (error) {
      if (!(error instanceof QueryError)) throw error;
      issue.addIssue({ code: "custom", message: error.message });
    }
  });

const createSchema = z.object({ name, query, shared: z.boolean().default(false) });
const updateSchema = z.object({ name, query, shared: z.boolean() }).partial();

/** Yours, then teammates' shared filters. */
export async function listSavedFilters(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  const userId = actingUserId(ctx) ?? "";
  const filters = await db.savedFilter.findMany({
    where: { workspaceId: ctx.workspaceId, OR: [{ ownerUserId: userId }, { shared: true }] },
    orderBy: [{ name: "asc" }],
    select: filterSelect,
  });
  return [...filters.filter((f) => f.owner.id === userId), ...filters.filter((f) => f.owner.id !== userId)];
}

export async function getSavedFilter(ctx: Ctx, id: string) {
  authorize(ctx, "workspace.read");
  const filter = await db.savedFilter.findFirst({
    where: { id, workspaceId: ctx.workspaceId, OR: [{ ownerUserId: actingUserId(ctx) ?? "" }, { shared: true }] },
    select: filterSelect,
  });
  if (!filter) throw notFound("Filter not found");
  return filter;
}

function nameTaken(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    throw new ServiceError(409, "You already have a filter with that name");
  }
  throw error;
}

export async function createSavedFilter(ctx: Ctx, input: unknown) {
  authorize(ctx, "filter.write");
  const data = createSchema.parse(input);
  if (data.shared) authorize(ctx, "filter.share");
  const ownerUserId = actingUserId(ctx);
  if (!ownerUserId) throw forbidden();
  return db.savedFilter
    .create({ data: { ...data, workspaceId: ctx.workspaceId, ownerUserId }, select: filterSelect })
    .catch(nameTaken);
}

async function findOwnFilter(ctx: Ctx, id: string) {
  const filter = await db.savedFilter.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, ownerUserId: true, shared: true },
  });
  // Someone else's personal filter doesn't exist as far as the caller knows.
  if (!filter || (filter.ownerUserId !== actingUserId(ctx) && !filter.shared)) throw notFound("Filter not found");
  return filter;
}

/** Only the owner changes a filter. */
export async function updateSavedFilter(ctx: Ctx, id: string, input: unknown) {
  authorize(ctx, "filter.write");
  const data = updateSchema.parse(input);
  if (!Object.keys(data).length) throw badRequest("Nothing to change");
  const filter = await findOwnFilter(ctx, id);
  if (filter.ownerUserId !== actingUserId(ctx)) throw forbidden();
  if (data.shared) authorize(ctx, "filter.share");
  return db.savedFilter.update({ where: { id }, data, select: filterSelect }).catch(nameTaken);
}

/** The owner deletes a filter; admins may also delete shared ones. */
export async function deleteSavedFilter(ctx: Ctx, id: string) {
  authorize(ctx, "filter.write");
  const filter = await findOwnFilter(ctx, id);
  if (filter.ownerUserId !== actingUserId(ctx) && !can(ctx, "filter.moderate")) throw forbidden();
  await db.savedFilter.delete({ where: { id } });
  return { deleted: true };
}
