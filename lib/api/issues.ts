/**
 * Client-side fetchers for issues. Cards live in the project detail cache
 * (projectKeys.detail); KanbanBoard and the issue modal apply optimistic
 * updates there and reconcile with these results.
 */

import { request } from "@/lib/api/http";
import type {
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

export async function createIssue(columnId: string, title: string) {
  const data = await request<{ issue: IssueCard }>(
    `/api/columns/${columnId}/issues`,
    "Failed to add issue",
    { method: "POST", body: { title } },
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
