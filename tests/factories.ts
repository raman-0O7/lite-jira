import { randomUUID } from "node:crypto";

import type { Role } from "@prisma/client";

import { db } from "@/lib/db";
import { userCtx } from "@/lib/services/context";
import { createWorkspace, ensurePersonalWorkspace } from "@/lib/services/workspaces";

export async function makeUser(name = "Ada Lovelace") {
  const id = randomUUID();
  return db.user.create({
    data: { id, name, email: `${id}@example.test` },
  });
}

/** A user with their personal workspace, plus an owner Ctx for it. */
export async function makeOwner(name?: string) {
  const user = await makeUser(name);
  const workspace = await ensurePersonalWorkspace(user);
  return { user, workspace, ctx: userCtx(user.id, workspace.id, "OWNER") };
}

/** Add `user` to a workspace with `role` and return their Ctx there. */
export async function addMember(
  workspaceId: string,
  user: { id: string },
  role: Role,
) {
  await db.membership.create({ data: { workspaceId, userId: user.id, role } });
  return userCtx(user.id, workspaceId, role);
}


/** A team workspace owned by a new user, plus the owner's Ctx. */
export async function makeTeam(name = "Acme", ownerName = "Owner") {
  const user = await makeUser(ownerName);
  const workspace = await createWorkspace(user.id, { name });
  return { user, workspace, ctx: userCtx(user.id, workspace.id, "OWNER") };
}

/** Share a project with a guest (a ProjectAccess row). */
export async function shareProject(workspaceId: string, userId: string, projectId: string) {
  const membership = await db.membership.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  await db.projectAccess.create({ data: { projectId, membershipId: membership.id } });
}
