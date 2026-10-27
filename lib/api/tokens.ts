import { request } from "@/lib/api/http";

export type TokenAccess = "READ" | "WRITE";

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  access: TokenAccess;
  projectIds: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  expired: boolean;
};

export type CreateTokenInput = {
  name: string;
  access: TokenAccess;
  projectIds: string[];
  expiresInDays: 30 | 90 | 365 | null;
};

export type ConnectedApp = {
  id: string;
  clientId: string;
  name: string;
  site: string | null;
  icon: string | null;
  scopes: string[];
  connectedAt: string;
};

export const tokenKeys = {
  list: (slug: string) => ["api-tokens", slug] as const,
  apps: ["oauth-apps"] as const,
};

export async function fetchTokens(slug: string) {
  const data = await request<{ tokens: ApiToken[] }>(
    `/api/workspaces/${slug}/tokens`,
    "Failed to load tokens",
  );
  return data.tokens;
}

export function createToken(slug: string, input: CreateTokenInput) {
  return request<{ token: ApiToken; secret: string }>(
    `/api/workspaces/${slug}/tokens`,
    "Failed to create token",
    { method: "POST", body: input },
  );
}

export function revokeToken(slug: string, tokenId: string) {
  return request(`/api/workspaces/${slug}/tokens/${tokenId}`, "Failed to revoke token", {
    method: "DELETE",
  });
}

export async function fetchConnectedApps() {
  const data = await request<{ apps: ConnectedApp[] }>("/api/oauth/apps", "Failed to load apps");
  return data.apps;
}

export function disconnectApp(id: string) {
  return request(`/api/oauth/apps/${id}`, "Failed to disconnect app", { method: "DELETE" });
}
