import { request } from "@/lib/api/http";

/** Mirrors SetupStatus in lib/services/setup.ts. */
export type SetupStatus = {
  projects: boolean;
  teammates: boolean;
  github: boolean;
  agents: boolean;
  assistant: boolean;
  claudeConnected: boolean;
};

export const setupKeys = { status: (slug: string) => ["setup", slug] as const };

export const fetchSetup = (slug: string) =>
  request<{ status: SetupStatus; mcpUrl: string }>(`/api/workspaces/${slug}/setup`, "Failed to load setup");
