import type { ProviderId } from "@/lib/ai/catalog";
import { request } from "@/lib/api/http";
import type { IssueType, Priority } from "@/lib/api/projects";

/** In-app AI (docs/features/20-in-app-ai.md, 24-multi-provider-ai.md). Every call only suggests. */

export type AiStatus = {
  ai: { available: boolean; canUse: boolean; reason: "off" | "no_key" | null; providerLabel: string | null };
  /** Admins only. */
  settings?: {
    enabled: boolean;
    provider: ProviderId;
    model: string;
    baseUrl: string | null;
    structuredOutputs: boolean;
    apiKeyHint: string | null;
    source: "workspace" | "platform" | null;
    /** Kanso's own key, when the server has one (and which provider answers on it, when it's in use). */
    platform: { dailyLimit: number; providerLabel: string | null; model: string | null } | null;
    agentKeyAvailable: boolean;
    usage: { requests: number; costUsd: number; unpricedRequests: number };
  };
};

export type AiSettingsPatch = {
  provider?: ProviderId;
  apiKey?: string | null;
  useAgentKey?: true;
  model?: string;
  baseUrl?: string | null;
  structuredOutputs?: boolean;
  enabled?: boolean;
};

export const aiKeys = { status: (slug: string) => ["ai", slug] as const };

export const fetchAi = (slug: string) => request<AiStatus>(`/api/workspaces/${slug}/ai`, "Couldn't load AI settings");

export const updateAi = (slug: string, patch: AiSettingsPatch) =>
  request<AiStatus>(`/api/workspaces/${slug}/ai`, "Couldn't save AI settings", { method: "PUT", body: patch });

export const testAi = (slug: string, patch: AiSettingsPatch) =>
  request<{ ok: true }>(`/api/workspaces/${slug}/ai/test`, "Couldn't test the connection", { method: "POST", body: patch });

type SuggestedType = Exclude<IssueType, "SUBTASK">;

export type IssueDraft = {
  title: string;
  description: string | null;
  type: SuggestedType;
  priority: Priority;
  assigneeUserId: string | null;
};

export const draftIssueWithAi = (projectId: string, text: string) =>
  request<IssueDraft>(`/api/projects/${projectId}/ai/draft`, "Couldn't fill in the issue", { method: "POST", body: { text } });

export const askProjectAi = (projectId: string, question: string) =>
  request<{ answer: string }>(`/api/projects/${projectId}/ai/ask`, "Couldn't answer that", {
    method: "POST",
    body: { question },
  });

export const breakDownWithAi = (issueId: string) =>
  request<{ subIssues: { title: string }[] }>(`/api/issues/${issueId}/ai/breakdown`, "Couldn't suggest sub-issues", {
    method: "POST",
  });

export type TriageSuggestion = {
  type: SuggestedType | null;
  priority: Priority;
  labelIds: string[];
  estimate: number | null;
  reason: string;
};

export const triageWithAi = (issueId: string) =>
  request<TriageSuggestion>(`/api/issues/${issueId}/ai/triage`, "Couldn't triage the issue", { method: "POST" });

export const summarizeWithAi = (issueId: string) =>
  request<{ summary: string }>(`/api/issues/${issueId}/ai/summary`, "Couldn't summarize the issue", { method: "POST" });
