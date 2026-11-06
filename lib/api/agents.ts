import { request } from "@/lib/api/http";

export type AgentKind = "CLAUDE_CODE" | "MCP" | "CLAUDE_API";

export type WorkspaceAgentModel = "claude-opus-5-5" | "claude-sonnet-5-5";

export const WORKSPACE_AGENT_MODELS: { id: WorkspaceAgentModel; label: string }[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (cheaper)" },
];

/** The workspace agent's settings (admins only; secrets as their last 4 characters). */
export type WorkspaceAgentSettings = {
  apiKeyHint: string;
  model: WorkspaceAgentModel;
  monthlyLimitCents: number;
  runLimitCents: number;
  consoleWorkspaceId: string | null;
};

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
  workspaceAgent?: WorkspaceAgentSettings;
  /** Workspace agent, admins: this month's spend and what active runs reserve (US cents). */
  spend?: { spentCents: number; reservedCents: number };
};

export type AgentSecrets = { token?: string; webhookSecret?: string };

export type CreateAgentInput =
  | { kind: "CLAUDE_CODE"; name: string; fireUrl: string; token: string }
  | { kind: "MCP"; name: string; webhookUrl: string | null }
  | {
      kind: "CLAUDE_API";
      name: string;
      apiKey: string;
      model: WorkspaceAgentModel;
      monthlyLimit: number;
      runLimit: number;
      consoleWorkspaceId: string | null;
    };

export type UpdateAgentInput = {
  name?: string;
  enabled?: boolean;
  fireUrl?: string;
  token?: string;
  webhookUrl?: string | null;
  // Workspace agent
  apiKey?: string;
  model?: WorkspaceAgentModel;
  monthlyLimit?: number;
  runLimit?: number;
  consoleWorkspaceId?: string | null;
};

/** Whether Kanso's GitHub App can push and open pull requests for the workspace agent (admins). */
export type WorkspaceAgentGitHub =
  | { status: "not_configured" | "not_connected" | "unknown" }
  | { status: "app_needs_access"; settingsUrl: string | null }
  | { status: "ready" | "needs_approval"; accounts: { login: string; ready: boolean; settingsUrl: string }[] };

export type AgentToken = { id: string; prefix: string; lastUsedAt: string | null; createdAt: string };

export type AgentRun = {
  id: string;
  status: AgentRunStatus;
  sessionUrl: string | null;
  prUrl: string | null;
  error: string | null;
  /** Workspace agent: list cost so far and the run's spend ceiling (US cents). */
  costCents: number | null;
  budgetCents: number | null;
  createdAt: string;
  dispatchedAt: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
  /** A Claude Code session lives in the Claude account that claimed the run: the runner's, else the owner's. */
  agent: { id: string; name: string; kind: AgentKind; owner: { id: string; name: string } };
  /** Whose connection claimed the run with its claim code, when not the owner's. */
  runner: { id: string; name: string } | null;
  requestedBy: { id: string; name: string; image: string | null } | null;
};

export const agentKeys = {
  list: (slug: string) => ["agents", slug] as const,
  tokens: (slug: string, agentId: string) => ["agents", slug, "tokens", agentId] as const,
  runs: (issueId: string) => ["agent-runs", issueId] as const,
  github: (slug: string) => ["agents", slug, "github"] as const,
};

const base = (slug: string) => `/api/workspaces/${slug}/agents`;

export async function fetchAgents(slug: string) {
  const data = await request<{ agents: Agent[] }>(base(slug), "Failed to load agents");
  return data.agents;
}

export async function fetchWorkspaceAgentGitHub(slug: string) {
  const data = await request<{ github: WorkspaceAgentGitHub }>(`${base(slug)}/github`, "Couldn’t check GitHub");
  return data.github;
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

/** "$12.40", or "$100" for whole dollars. */
export const formatCents = (cents: number) => `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
