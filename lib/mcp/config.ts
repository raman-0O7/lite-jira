import { appUrl } from "@/lib/app-url";

/**
 * MCP server identity. The resource URL is the RFC 8707 audience every OAuth
 * access token for the MCP server is bound to.
 */
export const MCP_PATH = "/api/mcp";
export const MCP_RESOURCE = `${appUrl()}${MCP_PATH}`;

/** OAuth scopes for Kanso data. `write` implies nothing about `read`; clients ask for both. */
export const MCP_SCOPES = {
  read: "kanso:read",
  write: "kanso:write",
} as const;

export const OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  MCP_SCOPES.read,
  MCP_SCOPES.write,
] as const;
