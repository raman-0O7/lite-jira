import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { appUrl } from "@/lib/app-url";
import { auth } from "@/lib/auth";
import { MCP_PATH, MCP_RESOURCE, MCP_SCOPES } from "@/lib/mcp/config";
import type { McpPrincipal } from "@/lib/mcp/principal";
import { hitRateLimit } from "@/lib/mcp/rate-limit";
import { createKansoMcpServer } from "@/lib/mcp/server";
import { API_TOKEN_PREFIX, ctxForApiToken, hashApiToken } from "@/lib/services/api-tokens";
import { hasConsent } from "@/lib/services/oauth-apps";

/**
 * The remote MCP endpoint. Two credentials are accepted:
 * - `Bearer kanso_…` — a personal API token, bound to one workspace;
 * - an OAuth access token (JWT) issued by Better Auth for this resource.
 * Each request builds a fresh server scoped to the caller (stateless).
 */

const handler = createMcpHandler(
  ({ authInfo }) => createKansoMcpServer(authInfo?.extra?.principal as McpPrincipal),
  { legacy: "stateless", onerror: (error) => console.error("[mcp]", error) },
);

function tooManyRequests(retryAfter: number) {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Rate limit exceeded" } },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

function unauthorized(message: string) {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message } },
    {
      status: 401,
      headers: {
        // Points OAuth clients at discovery so they can authorize again.
        "WWW-Authenticate": `Bearer error="invalid_token", resource_metadata="${appUrl()}/.well-known/oauth-protected-resource${MCP_PATH}"`,
      },
    },
  );
}

function serve(request: Request, token: string, clientId: string, scopes: string[], principal: McpPrincipal) {
  return handler.fetch(request, { authInfo: { token, clientId, scopes, extra: { principal } } });
}

const withOAuth = requireMcpAuth(
  auth,
  async (request, claims) => {
    const userId = String(claims.sub ?? "");
    const clientId = String(claims.azp ?? claims.client_id ?? "");
    const scopes = typeof claims.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
    if (!userId) return unauthorized("Invalid access token");
    const retryAfter = hitRateLimit(`oauth:${userId}:${clientId}`);
    if (retryAfter) return tooManyRequests(retryAfter);
    // Disconnecting the app in Settings takes effect before the JWT expires.
    if (!(await hasConsent(userId, clientId))) return unauthorized("This app was disconnected");
    const token = request.headers.get("authorization")?.slice("Bearer ".length) ?? "";
    return serve(request, token, clientId, scopes, { kind: "oauth", userId, clientId, scopes });
  },
  {
    resource: MCP_RESOURCE,
    requiredScopes: [MCP_SCOPES.read],
    challengeScopes: [MCP_SCOPES.read, MCP_SCOPES.write, "offline_access"],
  },
);

async function handle(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();

  if (bearer?.startsWith(API_TOKEN_PREFIX)) {
    const hash = hashApiToken(bearer);
    const retryAfter = hitRateLimit(`token:${hash}`);
    if (retryAfter) return tooManyRequests(retryAfter);
    const ctx = await ctxForApiToken(bearer);
    if (!ctx) return unauthorized("Invalid, expired, or revoked API token");
    const scopes = ctx.limits?.write ? [MCP_SCOPES.read, MCP_SCOPES.write] : [MCP_SCOPES.read];
    return serve(request, bearer, "api_token", scopes, { kind: "api_token", ctx });
  }

  return withOAuth(request);
}

export { handle as DELETE, handle as GET, handle as POST };
