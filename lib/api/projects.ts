/**
 * Client-side fetchers, shared types, and TanStack Query keys for projects and
 * columns. Issue cards live inside the project detail cache.
 */

import { request } from "@/lib/api/http";

// ---------- Shared types ----------

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type IssueType = "EPIC" | "STORY" | "TASK" | "BUG" | "SUBTASK";
export type ColumnCategory = "TODO" | "IN_PROGRESS" | "DONE";
export type ProjectMode = "KANBAN" | "SCRUM";

export type LabelStub = { id: string; name: string; color: string };
export type PersonStub = { id: string; name: string; image: string | null };

/** A project as shown in the projects list. */
export type ProjectSummary = {
  id: string;
  name: string;
  key: string;
  mode: ProjectMode;
  createdAt: string;
  updatedAt: string;
  columnCount: number;
  issueCount: number;
};

/** An issue as a card on the board (and in search results). */
export type IssueCard = {
  id: string;
  key: string;
  number: number;
  type: IssueType;
  title: string;
  position: number;
  priority: Priority;
  dueDate: string | null;
  estimate: number | null;
  columnId: string;
  parentId: string | null;
  labels: LabelStub[];
  assignee: PersonStub | null;
  subIssueCount: number;
  subIssueDoneCount: number;
};

export type ColumnWithIssues = {
  id: string;
  name: string;
  position: number;
  category: ColumnCategory;
  issues: IssueCard[];
};

export type ProjectDetail = {
  id: string;
  name: string;
  key: string;
  mode: ProjectMode;
  createdAt: string;
  updatedAt: string;
  columns: ColumnWithIssues[];
};

// ---------- Query keys ----------

export const projectKeys = {
  all: ["projects"] as const,
  lists: (workspaceSlug: string) =>
    [...projectKeys.all, "list", workspaceSlug] as const,
  detail: (id: string) => [...projectKeys.all, "detail", id] as const,
};

// ---------- Projects ----------

export async function fetchProjects(workspaceSlug: string) {
  const data = await request<{ projects: ProjectSummary[] }>(
    `/api/workspaces/${workspaceSlug}/projects`,
    "Failed to load projects",
  );
  return data.projects;
}

export async function fetchProject(id: string) {
  const data = await request<{ project: ProjectDetail }>(
    `/api/projects/${id}`,
    "Failed to load project",
  );
  return data.project;
}

export async function createProject(
  workspaceSlug: string,
  input: { name: string; key?: string },
) {
  const data = await request<{ project: ProjectSummary }>(
    `/api/workspaces/${workspaceSlug}/projects`,
    "Failed to create project",
    { method: "POST", body: input },
  );
  return data.project;
}

export async function renameProject(id: string, name: string) {
  const data = await request<{ project: ProjectSummary }>(
    `/api/projects/${id}`,
    "Failed to rename project",
    { method: "PATCH", body: { name } },
  );
  return data.project;
}

export async function deleteProject(id: string) {
  await request(`/api/projects/${id}`, "Failed to delete project", { method: "DELETE" });
}

/**
 * A key suggestion from a project name — mirrors suggestKey() on the server so
 * the create dialog can prefill it.
 */
export function suggestProjectKey(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters.length === 0) return "PRJ";
  return letters.length === 1 ? `${letters}P` : letters.slice(0, 3);
}

// ---------- Columns ----------

type ColumnFields = { id: string; name: string; position: number; category: ColumnCategory };

export async function createColumn(projectId: string, name: string) {
  const data = await request<{ column: ColumnWithIssues }>(
    `/api/projects/${projectId}/columns`,
    "Failed to add column",
    { method: "POST", body: { name } },
  );
  return data.column;
}

export async function updateColumn(
  id: string,
  patch: { name?: string; category?: ColumnCategory },
) {
  const data = await request<{ column: ColumnFields }>(
    `/api/columns/${id}`,
    "Failed to update column",
    { method: "PATCH", body: patch },
  );
  return data.column;
}

export const renameColumn = (id: string, name: string) => updateColumn(id, { name });

export async function deleteColumn(id: string) {
  await request(`/api/columns/${id}`, "Failed to delete column", { method: "DELETE" });
}

export async function reorderColumns(projectId: string, orderedIds: string[]) {
  await request("/api/columns/reorder", "Failed to reorder columns", {
    method: "PATCH",
    body: { projectId, orderedIds },
  });
}
