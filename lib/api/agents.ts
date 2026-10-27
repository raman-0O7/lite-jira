import { request } from "@/lib/api/http";

export type AgentKind = "CLAUDE_CODE" | "MCP";

export type AgentRunStatus =
  | "QUEUED"
  | "DISPATCHED"
  | "RUNNING"
  | "NEEDS_INPUT"
  | "PR_OPEN"
  | "DONE"
  | "FAILED"
  | "CANCELLED";

export type Agent = {
  id: string;
  name: string;
  kind: AgentKind;
  enabled: boolean;
  createdAt: string;
  owner: { id: string; name: string; image: string | null };
  tokenCount: number;
  fireUrl?: string;
  webhookUrl?: string | null;
};

export type AgentSecrets = { token?: string; webhookSecret?: string };

export type CreateAgentInput =
  | { kind: "CLAUDE_CODE"; name: string; fireUrl: string; token: string }
  | { kind: "MCP"; name: string; webhookUrl: string | null };

export type UpdateAgentInput = {
  name?: string;
  enabled?: boolean;
  fireUrl?: string;
  token?: string;
  webhookUrl?: string | null;
};

export type AgentToken = { id: string; prefix: string; lastUsedAt: string | null; createdAt: string };

export type AgentRun = {
  id: string;
  status: AgentRunStatus;
  sessionUrl: string | null;
  prUrl: string | null;
  error: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
  agent: { id: string; name: string; kind: AgentKind };
  requestedBy: { id: string; name: string; image: string | null } | null;
};

export const agentKeys = {
  list: (slug: string) => ["agents", slug] as const,
  tokens: (slug: string, agentId: string) => ["agents", slug, "tokens", agentId] as const,
  runs: (issueId: string) => ["agent-runs", issueId] as const,
};

const base = (slug: string) => `/api/workspaces/${slug}/agents`;

export async function fetchAgents(slug: string) {
  const data = await request<{ agents: Agent[] }>(base(slug), "Failed to load agents");
  return data.agents;
}

export const createAgent = (slug: string, input: CreateAgentInput) =>
  request<{ agent: Agent; secrets: AgentSecrets }>(base(slug), "Couldn’t create the agent", {
    method: "POST",
    body: input,
  });

export async function updateAgent(slug: string, id: string, input: UpdateAgentInput) {
  const data = await request<{ agent: Agent }>(`${base(slug)}/${id}`, "Couldn’t update the agent", {
    method: "PATCH",
    body: input,
  });
  return data.agent;
}

export const deleteAgent = (slug: string, id: string) =>
  request(`${base(slug)}/${id}`, "Couldn’t delete the agent", { method: "DELETE" });

export async function fetchAgentTokens(slug: string, id: string) {
  const data = await request<{ tokens: AgentToken[] }>(`${base(slug)}/${id}/tokens`, "Failed to load tokens");
  return data.tokens;
}

export const createAgentToken = (slug: string, id: string) =>
  request<{ token: AgentToken; secret: string }>(`${base(slug)}/${id}/tokens`, "Couldn’t create a token", {
    method: "POST",
  });

export const revokeAgentToken = (slug: string, id: string, tokenId: string) =>
  request(`${base(slug)}/${id}/tokens/${tokenId}`, "Couldn’t revoke the token", { method: "DELETE" });

export async function fetchAgentRuns(issueId: string) {
  const data = await request<{ runs: AgentRun[] }>(`/api/issues/${issueId}/agent-runs`, "Failed to load runs");
  return data.runs;
}

export const retryAgentRun = (issueId: string) =>
  request<{ runId: string }>(`/api/issues/${issueId}/agent/retry`, "Couldn’t retry", { method: "POST" });

/** Statuses where the agent still owes work (mirrors ACTIVE_RUN on the server). */
export const ACTIVE_RUN_STATUSES: AgentRunStatus[] = ["QUEUED", "DISPATCHED", "RUNNING", "NEEDS_INPUT", "PR_OPEN"];

export const RUN_STATUS_LABEL: Record<AgentRunStatus, string> = {
  QUEUED: "Queued",
  DISPATCHED: "Dispatched",
  RUNNING: "Working",
  NEEDS_INPUT: "Needs input",
  PR_OPEN: "PR open",
  DONE: "Done",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};
