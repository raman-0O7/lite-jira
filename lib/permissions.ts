import type { Role } from "@prisma/client";

import type { Ctx } from "@/lib/services/context";
import { forbidden } from "@/lib/services/errors";

/**
 * Role-based permissions (PLAN-v2 §4 "Roles", docs/features/06-foundation-v2.md).
 *
 * Every service calls `authorize(ctx, action)` before touching data. The
 * caller's membership is already established by the time a Ctx exists, so a
 * failed check is a 403 — non-members never get this far (they get a 404 from
 * workspace resolution).
 */
export type Action =
  | "workspace.read"
  | "project.read"
  | "project.create"
  | "project.update"
  | "project.delete"
  | "column.write"
  | "issue.write"
  | "label.write"
  | "comment.write"
  | "comment.moderate"
  | "members.manage"
  | "integrations.manage"
  | "workspace.delete";

// Guests can read and comment (PLAN-v2 §4); they can't change issues.
const READ: Action[] = ["workspace.read", "project.read", "comment.write"];
const WRITE: Action[] = [
  "project.create",
  "project.update",
  "column.write",
  "issue.write",
  "label.write",
];
const ADMIN: Action[] = [
  "project.delete",
  "comment.moderate",
  "members.manage",
  "integrations.manage",
];

const ROLE_ACTIONS: Record<Role, ReadonlySet<Action>> = {
  OWNER: new Set([...READ, ...WRITE, ...ADMIN, "workspace.delete"]),
  ADMIN: new Set([...READ, ...WRITE, ...ADMIN]),
  MEMBER: new Set([...READ, ...WRITE]),
  GUEST: new Set(READ),
};

/** Actions an agent may never perform, whatever its on-behalf-of user's role. */
const AGENT_NEVER: ReadonlySet<Action> = new Set([
  "project.delete",
  "comment.moderate",
  "members.manage",
  "integrations.manage",
  "workspace.delete",
]);

export function can(ctx: Pick<Ctx, "actor" | "role">, action: Action): boolean {
  if (ctx.actor.type === "agent" && AGENT_NEVER.has(action)) return false;
  return ROLE_ACTIONS[ctx.role].has(action);
}

export function authorize(ctx: Pick<Ctx, "actor" | "role">, action: Action) {
  if (!can(ctx, action)) throw forbidden();
}
