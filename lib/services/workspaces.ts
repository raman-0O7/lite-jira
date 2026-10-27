import { randomBytes } from "node:crypto";

import { Prisma, type Role } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { type Ctx, userCtx } from "@/lib/services/context";
import { badRequest, ServiceError } from "@/lib/services/errors";
import { slugify } from "@/lib/slug";
import {
  createWorkspaceSchema,
  updateWorkspaceSchema,
} from "@/lib/validations/workspace";

/**
 * Workspace lookup, creation, and settings.
 *
 * Lookup and creation establish context (who belongs where) rather than act
 * within it, so they take a user id instead of a Ctx. Renaming and deleting
 * act on an existing workspace and take a Ctx like every other service.
 */

/** Slugs that would collide with top-level app routes. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "_next",
  "admin",
  "api",
  "app",
  "auth",
  "boards",
  "invite",
  "issues",
  "login",
  "logout",
  "new",
  "projects",
  "settings",
  "signup",
  "static",
]);

/**
 * A slug for `name` that is not taken and not reserved. Personal workspaces
 * always get a short random suffix so two people with the same name never
 * race for the bare slug.
 */
async function availableSlug(name: string, forceSuffix: boolean) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffixed =
      forceSuffix || attempt > 0 || base.length < 3 || RESERVED_SLUGS.has(base);
    const slug = suffixed ? `${base}-${randomBytes(3).toString("hex")}` : base;
    const taken = await db.workspace.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!taken) return slug;
  }
  // Five collisions on a 24-bit suffix means something is badly wrong.
  throw new Error(`Could not find a free slug for "${name}"`);
}

/**
 * Create the user's personal workspace (OWNER membership) unless they already
 * have one. Idempotent: safe to call from the signup hook and again lazily.
 */
export async function ensurePersonalWorkspace(user: {
  id: string;
  name: string;
}) {
  const existing = await db.membership.findFirst({
    where: { userId: user.id, workspace: { personal: true } },
    select: { workspace: { select: { id: true, slug: true } } },
  });
  if (existing) return existing.workspace;

  const name = user.name.trim() || "Personal";
  return db.workspace.create({
    data: {
      name,
      slug: await availableSlug(name, true),
      personal: true,
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
    select: { id: true, slug: true },
  });
}

/** The workspace a user lands in after login: personal first, else oldest. */
export async function defaultWorkspaceSlug(user: { id: string; name: string }) {
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
    select: { workspace: { select: { slug: true, personal: true } } },
  });
  const personal = memberships.find((m) => m.workspace.personal);
  if (personal) return personal.workspace.slug;
  if (memberships[0]) return memberships[0].workspace.slug;
  return (await ensurePersonalWorkspace(user)).slug;
}

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  personal: boolean;
  role: Role;
};

export async function listWorkspacesForUser(
  userId: string,
): Promise<WorkspaceSummary[]> {
  const memberships = await db.membership.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      workspace: {
        select: { id: true, name: true, slug: true, personal: true },
      },
    },
  });
  return memberships.map((m) => ({ ...m.workspace, role: m.role }));
}

/** The user's membership in the workspace with `slug`, or null. */
export async function findMembershipBySlug(
  userId: string,
  slug: string,
): Promise<WorkspaceSummary | null> {
  const membership = await db.membership.findFirst({
    where: { userId, workspace: { slug } },
    select: {
      role: true,
      workspace: {
        select: { id: true, name: true, slug: true, personal: true },
      },
    },
  });
  return membership ? { ...membership.workspace, role: membership.role } : null;
}

/** The slug of the workspace a Ctx is scoped to. */
export async function workspaceSlugForCtx(ctx: { workspaceId: string }) {
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { slug: true },
  });
  return workspace.slug;
}

const summarySelect = { id: true, name: true, slug: true, personal: true } as const;

/** Create a team workspace with the user as its owner. */
export async function createWorkspace(
  userId: string,
  input: unknown,
): Promise<WorkspaceSummary> {
  const parsed = createWorkspaceSchema.parse(input);
  if (parsed.slug && RESERVED_SLUGS.has(parsed.slug)) {
    throw badRequest(`The URL "${parsed.slug}" is reserved`);
  }
  const slug = parsed.slug ?? (await availableSlug(parsed.name, false));

  try {
    return await db.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: parsed.name,
          slug,
          memberships: { create: { userId, role: "OWNER" } },
        },
        select: summarySelect,
      });
      await recordActivity(tx, userCtx(userId, workspace.id, "OWNER"), {
        action: "workspace.created",
        data: { name: parsed.name, slug },
      });
      return { ...workspace, role: "OWNER" as const };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ServiceError(409, `The URL "${slug}" is already taken`);
    }
    throw error;
  }
}

/** Rename the ctx workspace. The slug never changes (it's in every URL). */
export async function updateWorkspace(ctx: Ctx, input: unknown) {
  authorize(ctx, "workspace.update");
  const { name } = updateWorkspaceSchema.parse(input);
  return db.$transaction(async (tx) => {
    const before = await tx.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { name: true },
    });
    const workspace = await tx.workspace.update({
      where: { id: ctx.workspaceId },
      data: { name },
      select: summarySelect,
    });
    await recordActivity(tx, ctx, {
      action: "workspace.updated",
      data: { name: { from: before.name, to: name } },
    });
    return { ...workspace, role: ctx.role };
  });
}

/**
 * Delete the ctx workspace and everything in it (cascades). Personal
 * workspaces can't be deleted. Nothing is logged: the activity goes with it.
 */
export async function deleteWorkspace(ctx: Ctx) {
  authorize(ctx, "workspace.delete");
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { personal: true },
  });
  if (workspace.personal) throw badRequest("Your personal workspace can't be deleted");
  await db.workspace.delete({ where: { id: ctx.workspaceId } });
}
