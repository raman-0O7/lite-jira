import { MCP_SCOPES } from "@/lib/mcp/config";

/** OAuth scopes in plain words, for the consent screen and connected apps. */
export const SCOPE_DESCRIPTIONS: Record<string, string> = {
  [MCP_SCOPES.read]: "Read your workspaces, projects, issues, and comments",
  [MCP_SCOPES.write]: "Create and update issues and comments as you",
  openid: "Know who you are",
  profile: "See your name and picture",
  email: "See your email address",
  offline_access: "Stay connected until you disconnect it",
};

export function describeScopes(scope: string | null | undefined) {
  const scopes = [...new Set((scope ?? "").split(" ").filter(Boolean))];
  return scopes.map((s) => ({ scope: s, label: SCOPE_DESCRIPTIONS[s] ?? s }));
}
