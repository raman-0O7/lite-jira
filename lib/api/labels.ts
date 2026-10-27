/** Client-side fetchers + query keys for project labels. */

import { request } from "@/lib/api/http";
import type { LabelStub } from "@/lib/api/projects";

export type { LabelStub };

export const labelKeys = {
  all: ["labels"] as const,
  project: (projectId: string) => [...labelKeys.all, "project", projectId] as const,
};

export async function fetchProjectLabels(projectId: string) {
  const data = await request<{ labels: LabelStub[] }>(
    `/api/projects/${projectId}/labels`,
    "Failed to load labels",
  );
  return data.labels;
}

export async function createLabel(projectId: string, input: { name: string; color: string }) {
  const data = await request<{ label: LabelStub }>(
    `/api/projects/${projectId}/labels`,
    "Failed to create label",
    { method: "POST", body: input },
  );
  return data.label;
}

export async function updateLabel(id: string, input: { name?: string; color?: string }) {
  const data = await request<{ label: LabelStub }>(`/api/labels/${id}`, "Failed to update label", {
    method: "PATCH",
    body: input,
  });
  return data.label;
}

export async function deleteLabel(id: string) {
  await request(`/api/labels/${id}`, "Failed to delete label", { method: "DELETE" });
}
