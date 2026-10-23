import { randomBytes } from "node:crypto";

import type { Role } from "@prisma/client";

import { db } from "@/lib/db";

/**
 * Workspace lookup and creation.
 *
 * These functions establish context (who belongs where) rather than act within
 * it, so unlike the other services they take a user id instead of a Ctx.
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
  "login",
  "logout",
  "new",
  "settings",
  "signup",
  "static",
]);

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return base || "workspace";
}

/**
 * A slug for `name` that is not taken and not reserved. Personal workspaces
 * always get a short random suffix so two people with the same name never
 * race for the bare slug.
 */
async function availableSlug(name: string, forceSuffix: boolean) {
  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const suffixed = forceSuffix || attempt > 0 || RESERVED_SLUGS.has(base);
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
