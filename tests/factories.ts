import { randomUUID } from "node:crypto";

import type { Role } from "@prisma/client";

import { db } from "@/lib/db";
import { userCtx } from "@/lib/services/context";
import { ensurePersonalWorkspace } from "@/lib/services/workspaces";

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

