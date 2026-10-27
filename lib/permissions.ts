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
  | "agent.manage"
  | "agent.dispatch"
  | "workspace.update"
  | "workspace.delete"
  | "token.manage";

// Guests can read and comment (PLAN-v2 §4); they can't change issues. Everyone
// manages their own API tokens.
const READ: Action[] = ["workspace.read", "project.read", "comment.write", "token.manage"];
const WRITE: Action[] = [
  "project.create",
  "project.update",
  "column.write",
  "issue.write",
  "label.write",
  "agent.dispatch",
];
const ADMIN: Action[] = [
  "project.delete",
  "comment.moderate",
  "members.manage",
  "integrations.manage",
  "agent.manage",
  "workspace.update",
];

const ROLE_ACTIONS: Record<Role, ReadonlySet<Action>> = {
  OWNER: new Set([...READ, ...WRITE, ...ADMIN, "workspace.delete"]),
  ADMIN: new Set([...READ, ...WRITE, ...ADMIN]),
  MEMBER: new Set([...READ, ...WRITE]),
  GUEST: new Set(READ),
};

/**
 * Actions an agent — or any token-based client (MCP, API token) — may never
 * perform, whatever the role behind it.
 */
const AGENT_NEVER: ReadonlySet<Action> = new Set([
  "project.delete",
  "comment.moderate",
  "members.manage",
  "integrations.manage",
  "agent.manage",
  // Only people hand work to agents.
  "agent.dispatch",
  "workspace.update",
  "workspace.delete",
  // A token can't mint or revoke tokens.
  "token.manage",
]);

/** What a read-only credential can still do. */
const READ_ONLY: ReadonlySet<Action> = new Set(["workspace.read", "project.read"]);

type AuthzCtx = Pick<Ctx, "actor" | "role" | "limits">;

export function can(ctx: AuthzCtx, action: Action): boolean {
  if ((ctx.actor.type === "agent" || ctx.limits) && AGENT_NEVER.has(action)) return false;
  if (ctx.limits) {
    if (!ctx.limits.write && !READ_ONLY.has(action)) return false;
    // A project-limited token can't create projects it then couldn't see.
    if (ctx.limits.projectIds && action === "project.create") return false;
  }
  return ROLE_ACTIONS[ctx.role].has(action);
}

export function authorize(ctx: AuthzCtx, action: Action) {
  if (!can(ctx, action)) throw forbidden();
}
