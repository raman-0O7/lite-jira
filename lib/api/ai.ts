import type { IssueType, Priority } from "@/lib/api/projects";
import { request } from "@/lib/api/http";

/** In-app AI (docs/features/20-in-app-ai.md). Every call only suggests. */

export const AI_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "Best results" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "Balanced" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", hint: "Fastest and cheapest" },
] as const;
export type AiModel = (typeof AI_MODELS)[number]["id"];

export type AiStatus = {
  ai: { available: boolean; canUse: boolean; reason: "off" | "no_key" | null };
  /** Admins only. */
  settings?: {
    enabled: boolean;
    model: AiModel;
    apiKeyHint: string | null;
    source: "workspace" | "platform" | null;
    platform: { dailyLimit: number } | null;
    agentKeyAvailable: boolean;
    usage: { requests: number; costUsd: number };
  };
};

export const aiKeys = { status: (slug: string) => ["ai", slug] as const };

export const fetchAi = (slug: string) => request<AiStatus>(`/api/workspaces/${slug}/ai`, "Couldn't load AI settings");

export const updateAi = (
  slug: string,
  patch: { apiKey?: string | null; useAgentKey?: true; model?: AiModel; enabled?: boolean },
) => request<AiStatus>(`/api/workspaces/${slug}/ai`, "Couldn't save AI settings", { method: "PUT", body: patch });

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
