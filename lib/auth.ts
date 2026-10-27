import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { jwt } from "better-auth/plugins";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/lib/db";
import { MCP_RESOURCE, MCP_SCOPES, OAUTH_SCOPES } from "@/lib/mcp/config";
import { ensurePersonalWorkspace } from "@/lib/services/workspaces";

const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

// Only register the GitHub provider when both credentials are present, so the
// app still boots locally without GitHub OAuth configured.
const socialProviders: BetterAuthOptions["socialProviders"] =
  githubClientId && githubClientSecret
    ? {
        github: {
          clientId: githubClientId,
          clientSecret: githubClientSecret,
        },
      }
    : undefined;

export const auth = betterAuth({
  database: prismaAdapter(db, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders,
  databaseHooks: {
    user: {
      create: {
        // Every account starts with a personal workspace. /boards also creates
        // it lazily, so a failure here never locks a user out.
        after: async (user) => {
          await ensurePersonalWorkspace(user);
        },
      },
    },
  },
  // The JWT plugin's own /token endpoint is not used; OAuth clients get tokens
  // from /oauth2/token.
  disabledPaths: ["/token"],
  plugins: [
    // Signs OAuth access tokens; /api/mcp verifies them against /api/auth/jwks.
    jwt(),
    // OAuth 2.1 authorization server for MCP clients (docs/features/10-mcp-server.md).
    mcp({
      resource: MCP_RESOURCE,
      loginPage: "/login",
      consentPage: "/oauth/consent",
      scopes: [...OAUTH_SCOPES],
      // Prisma can't store a resource without an explicit scope list.
      resources: [{ identifier: MCP_RESOURCE, allowedScopes: [...OAUTH_SCOPES] }],
      clientRegistrationDefaultScopes: [...OAUTH_SCOPES],
      // Client ID Metadata Documents are the MCP default; dynamic registration
      // stays on for clients that don't support them yet (Cursor, older CLIs).
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      clientRegistrationDefaultApplicationType: "infer",
      scopeExpirations: { [MCP_SCOPES.write]: "1h" },
    }),
    cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    // nextCookies must be the last plugin so it can set cookies from server actions.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;

/**
 * Returns the current Better Auth session (or null) on the server.
 */
export async function getSession() {
  return auth.api.getSession({
    headers: await headers(),
  });
}

/**
 * Returns the authenticated user, redirecting to /login when no session exists.
 * Use in server components / route handlers that require authentication.
 */
export async function requireUser() {
  const session = await getSession();

  if (!session) {
    redirect("/login");
  }

  return session.user;
}
