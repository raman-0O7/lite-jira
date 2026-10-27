/**
 * Client-side fetchers for issues. Cards live in the project detail cache
 * (projectKeys.detail); KanbanBoard and the issue modal apply optimistic
 * updates there and reconcile with these results.
 */

import { request } from "@/lib/api/http";
import type {
  AgentStub,
  IssueCard,
  IssueType,
  LabelStub,
  PersonStub,
  Priority,
} from "@/lib/api/projects";

type Related = { id: string; key: string; number: number; title: string; type: IssueType };

/** Full issue as returned by GET /api/issues/[id]. */
export type IssueFull = IssueCard & {
  description: string | null;
  acceptanceCriteria: string | null;
  projectId: string;
  epicId: string | null;
  assigneeUserId: string | null;
  source: "NATIVE" | "GITHUB";
  createdAt: string;
  updatedAt: string;
  project: { key: string; name: string };
  column: { id: string; name: string; category: "TODO" | "IN_PROGRESS" | "DONE" };
  reporter: PersonStub | null;
  parent: Related | null;
  epic: Related | null;
  subIssues: (Related & { done: boolean; assignee: PersonStub | null })[];
};

export const issueKeys = {
  detail: (id: string) => ["issue", id] as const,
  comments: (id: string) => ["issue", id, "comments"] as const,
  activity: (id: string) => ["issue", id, "activity"] as const,
};

/** Every key is optional; only present keys change. Nullable fields accept null to clear. */
export type UpdateIssuePayload = {
  title?: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  priority?: Priority;
  type?: IssueType;
  dueDate?: string | null;
  estimate?: number | null;
  labelIds?: string[];
  assigneeUserId?: string | null;
  epicId?: string | null;
};

export type CreateIssuePayload = {
  title: string;
  type?: Exclude<IssueType, "SUBTASK">;
  priority?: Priority;
  description?: string | null;
  assigneeUserId?: string | null;
};

/** Append an issue to a column: a title, or the new-issue dialog's fields. */
export async function createIssue(columnId: string, input: string | CreateIssuePayload) {
  const data = await request<{ issue: IssueCard }>(
    `/api/columns/${columnId}/issues`,
    "Failed to add issue",
    { method: "POST", body: typeof input === "string" ? { title: input } : input },
  );
  return data.issue;
}

export async function createSubIssue(parentId: string, title: string) {
  const data = await request<{ issue: IssueCard }>(
    `/api/issues/${parentId}/subissues`,
    "Failed to add sub-issue",
    { method: "POST", body: { title } },
  );
  return data.issue;
}

export async function fetchIssue(id: string) {
  const data = await request<{ issue: IssueFull }>(`/api/issues/${id}`, "Failed to load issue");
  return data.issue;
}

export async function updateIssue(id: string, payload: UpdateIssuePayload) {
  const data = await request<{ issue: IssueFull }>(`/api/issues/${id}`, "Failed to update issue", {
    method: "PATCH",
    body: payload,
  });
  return data.issue;
}

export async function deleteIssue(id: string) {
  await request(`/api/issues/${id}`, "Failed to delete issue", { method: "DELETE" });
}

/** Reposition within / across columns. */
export async function moveIssue(args: {
  issueId: string;
  toColumnId: string;
  toPosition: number;
}) {
  await request("/api/issues/move", "Failed to move issue", { method: "PATCH", body: args });
}

export type { LabelStub };

export type IssueSearchResult = IssueCard & { project: { id: string; key: string; name: string } };

/** Search the workspace's issues with the query language (text, keys, `assignee:me`…). */
export async function searchIssues(workspaceSlug: string, query: string) {
  const data = await request<{ issues: IssueSearchResult[] }>(
    `/api/workspaces/${workspaceSlug}/issues?q=${encodeURIComponent(query)}`,
    "Search failed",
  );
  return data.issues;
}

// ---------- Activity ----------

type ColumnRef = { id: string; name: string; category: "TODO" | "IN_PROGRESS" | "DONE" };

/** One row of an issue's history; `data` depends on the action (see lib/services/issues.ts). */
export type IssueActivityEntry = {
  id: string;
  action:
    | "issue.created"
    | "issue.updated"
    | "issue.moved"
    | "agent.assigned"
    | "agent.claimed"
    | "agent.progress"
    | "agent.pr_opened"
    | "agent.done"
    | "agent.failed"
    | "agent.released";
  createdAt: string;
  actorType: "USER" | "AGENT" | "GITHUB" | "SYSTEM";
  actorAgentId: string | null;
  actor: PersonStub | null;
  agent: AgentStub | null;
  data: Record<string, unknown>;
};

export type IssueActivity = {
  entries: IssueActivityEntry[];
  refs: {
    people: Record<string, PersonStub>;
    columns: Record<string, ColumnRef>;
    labels: Record<string, LabelStub>;
    issues: Record<string, { id: string; key: string; title: string }>;
    agents: Record<string, AgentStub>;
  };
};

export async function fetchIssueActivity(issueId: string) {
  return request<IssueActivity>(`/api/issues/${issueId}/activity`, "Failed to load activity");
}

// ---------- Agents ----------

/** Assign the issue to an agent (starts a run) or clear the agent with null. */
export async function assignAgent(id: string, agentId: string | null) {
  const data = await request<{ issue: IssueFull }>(`/api/issues/${id}/agent`, "Couldn’t assign the agent", {
    method: "PUT",
    body: { agentId },
  });
  return data.issue;
}
