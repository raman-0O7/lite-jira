import { MCP_SCOPES } from "@/lib/mcp/config";
import type { Ctx } from "@/lib/services/context";
import { userCtx } from "@/lib/services/context";
import { badRequest, notFound } from "@/lib/services/errors";
import {
  findMembershipBySlug,
  listWorkspacesForUser,
  workspaceSlugForCtx,
} from "@/lib/services/workspaces";

/**
 * Who is calling the MCP server, as established by /api/mcp before any tool
 * runs: an API token (already bound to a workspace) or an OAuth access token
 * (bound to a user; the workspace comes from each call).
 */
export type McpPrincipal =
  | { kind: "api_token"; ctx: Ctx }
  | { kind: "oauth"; userId: string; clientId: string; scopes: string[] };

export function principalUserId(principal: McpPrincipal): string {
  if (principal.kind === "oauth") return principal.userId;
  const { actor } = principal.ctx;
  return actor.type === "user" ? actor.userId : actor.type === "agent" ? actor.onBehalfOf : "";
}

export function canWrite(principal: McpPrincipal): boolean {
  return principal.kind === "oauth"
    ? principal.scopes.includes(MCP_SCOPES.write)
    : (principal.ctx.limits?.write ?? false);
}

/**
 * The service Ctx for one tool call. API tokens only work in their own
 * workspace. OAuth callers name a workspace by slug, or omit it when they
 * belong to exactly one.
 */
export async function ctxForCall(principal: McpPrincipal, workspace?: string): Promise<Ctx> {
  const slug = workspace?.trim().toLowerCase() || undefined;

  if (principal.kind === "api_token") {
    if (slug) {
      const own = await workspaceSlugForCtx(principal.ctx);
      if (own !== slug) throw badRequest(`This API token only works in the "${own}" workspace`);
    }
    return principal.ctx;
  }

  const limits = { write: canWrite(principal), projectIds: null };
  const toCtx = (workspaceId: string, role: Ctx["role"]): Ctx => ({
    ...userCtx(principal.userId, workspaceId, role, "mcp"),
    limits,
  });

  if (slug) {
    const membership = await findMembershipBySlug(principal.userId, slug);
    if (!membership) throw notFound("Workspace not found");
    return toCtx(membership.id, membership.role);
  }
  const workspaces = await listWorkspacesForUser(principal.userId);
  if (workspaces.length === 1) return toCtx(workspaces[0]!.id, workspaces[0]!.role);
  throw badRequest(
    `You belong to several workspaces — pass "workspace" as one of: ${workspaces
      .map((w) => w.slug)
      .join(", ")}`,
  );
}
