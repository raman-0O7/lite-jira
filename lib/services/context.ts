import type { Role } from "@prisma/client";

/**
 * Who is performing an operation. Shape fixed by PLAN-v2 §3 — do not diverge.
 *
 * - `user`   — a signed-in person (web UI, or an API token / OAuth client later).
 * - `agent`  — an AI agent acting on behalf of a user (Feature 12).
 * - `github` — GitHub App sync jobs (Feature 11).
 * - `system` — migrations, backfills, scheduled maintenance.
 */
export type Actor =
  | { type: "user"; userId: string }
  | { type: "agent"; agentId: string; onBehalfOf: string }
  | { type: "github"; installationId: string }
  | { type: "system" };

export type Via = "web" | "mcp" | "api_token" | "github" | "dispatcher";

/**
 * The context every service function receives.
 *
 * `role` is the actor's role in `workspaceId`, resolved once by the entry point
 * (for agents: the on-behalf-of user's role; the agent cap is applied by
 * `authorize`). Services trust it and scope every query to `workspaceId`.
 *
 * Service inputs are typed `unknown`: they arrive from HTTP, MCP, or webhooks,
 * and each service validates them with its Zod schema.
 */
export type Ctx = {
  actor: Actor;
  workspaceId: string;
  role: Role;
  via: Via;
};

export function userCtx(
  userId: string,
  workspaceId: string,
  role: Role,
  via: Via = "web",
): Ctx {
  return { actor: { type: "user", userId }, workspaceId, role, via };
}

/**
 * The person an operation is attributed to: the user, or the user an agent
 * acts for. Null for GitHub sync and system jobs.
 */
export function actingUserId(ctx: Ctx): string | null {
  if (ctx.actor.type === "user") return ctx.actor.userId;
  if (ctx.actor.type === "agent") return ctx.actor.onBehalfOf;
  return null;
}
