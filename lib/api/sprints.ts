import { request } from "@/lib/api/http";
import type { IssueSearchResult } from "@/lib/api/issues";
import type { ProjectMode, ProjectSummary, SprintState } from "@/lib/api/projects";

/** Client for sprints, the backlog and sprint reports (docs/features/21-sprints.md). */

export type Sprint = {
  id: string;
  number: number;
  name: string;
  goal: string | null;
  state: SprintState;
  startDate: string | null;
  endDate: string | null;
  startedAt: string | null;
  completedAt: string | null;
  committedIssues: number | null;
  committedPoints: number | null;
  completedIssues: number | null;
  completedPoints: number | null;
  createdAt: string;
};

export type SprintTotals = { issues: number; points: number; doneIssues: number; donePoints: number };
export type SprintWithTotals = Sprint & { totals: SprintTotals };

/** A backlog row: a card plus its status (no project; it's this project). */
export type BacklogIssue = Omit<IssueSearchResult, "project" | "updatedAt">;

export type Backlog = {
  mode: ProjectMode;
  sprints: (Sprint & { issues: BacklogIssue[] })[];
  backlog: BacklogIssue[];
};

export type Burndown = {
  sprint: { id: string; name: string; state: SprintState; startDate: string; endDate: string };
  unit: "points" | "issues";
  committed: number;
  days: { date: string; remaining: number | null; scope: number | null }[];
};

export type Velocity = {
  unit: "points" | "issues";
  sprints: { id: string; name: string; committed: number; completed: number }[];
  average: number | null;
};

export const sprintKeys = {
  list: (projectId: string) => ["sprints", projectId] as const,
  backlog: (projectId: string) => ["sprints", projectId, "backlog"] as const,
  velocity: (projectId: string) => ["sprints", projectId, "velocity"] as const,
  burndown: (sprintId: string) => ["sprint-burndown", sprintId] as const,
};

export const fetchSprints = (projectId: string) =>
  request<{ sprints: SprintWithTotals[] }>(`/api/projects/${projectId}/sprints`, "Failed to load sprints").then(
    (d) => d.sprints,
  );

export const fetchBacklog = (projectId: string) =>
  request<Backlog>(`/api/projects/${projectId}/backlog`, "Failed to load the backlog");

export const fetchVelocity = (projectId: string) =>
  request<Velocity>(`/api/projects/${projectId}/velocity`, "Failed to load velocity");

export const fetchBurndown = (sprintId: string) =>
  request<Burndown>(`/api/sprints/${sprintId}/burndown`, "Failed to load the burndown");

export const createSprint = (projectId: string, body: { name?: string; goal?: string | null } = {}) =>
  request<{ sprint: Sprint }>(`/api/projects/${projectId}/sprints`, "Couldn’t create the sprint", {
    method: "POST",
    body,
  }).then((d) => d.sprint);

export const updateSprint = (
  sprintId: string,
  body: { name?: string; goal?: string | null; startDate?: string | null; endDate?: string | null },
) =>
  request<{ sprint: Sprint }>(`/api/sprints/${sprintId}`, "Couldn’t save the sprint", { method: "PATCH", body }).then(
    (d) => d.sprint,
  );

export const deleteSprint = (sprintId: string) =>
  request(`/api/sprints/${sprintId}`, "Couldn’t delete the sprint", { method: "DELETE" });

export const startSprint = (
  sprintId: string,
  body: { name?: string; goal?: string | null; startDate?: string; endDate: string },
) =>
  request<{ sprint: Sprint }>(`/api/sprints/${sprintId}/start`, "Couldn’t start the sprint", {
    method: "POST",
    body,
  }).then((d) => d.sprint);

export const completeSprint = (sprintId: string, moveOpenTo: string) =>
  request<{ sprint: Sprint; moved: number; movedTo: { id: string; name: string } | null }>(
    `/api/sprints/${sprintId}/complete`,
    "Couldn’t complete the sprint",
    { method: "POST", body: { moveOpenTo } },
  );

export const setProjectMode = (projectId: string, mode: ProjectMode) =>
  request<{ project: ProjectSummary }>(`/api/projects/${projectId}`, "Couldn’t change the project", {
    method: "PATCH",
    body: { mode },
  }).then((d) => d.project);

/** Whole days from today (UTC) to `date`; negative once it's past. */
export function daysLeft(date: string | null, now = new Date()) {
  if (!date) return null;
  const end = new Date(date);
  const day = 24 * 60 * 60 * 1000;
  const utc = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.round((utc(end) - utc(now)) / day);
}
