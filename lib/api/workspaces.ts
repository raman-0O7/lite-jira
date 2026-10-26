import { request } from "@/lib/api/http";

export type Role = "OWNER" | "ADMIN" | "MEMBER" | "GUEST";

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  personal: boolean;
  role: Role;
};

export type Invite = {
  id: string;
  email: string | null;
  role: Role;
  projectIds: string[];
  expiresAt: string;
  createdAt: string;
  expired: boolean;
  invitedBy: { id: string; name: string } | null;
};

export type InviteResult = { invite: Invite; url: string; emailSent: boolean };

export const workspaceKeys = {
  all: ["workspaces"] as const,
  invites: (slug: string) => ["invites", slug] as const,
};

export async function fetchWorkspaces() {
  const data = await request<{ workspaces: WorkspaceSummary[] }>(
    "/api/workspaces",
    "Failed to load workspaces",
  );
  return data.workspaces;
}

export async function createWorkspace(input: { name: string; slug?: string }) {
  const data = await request<{ workspace: WorkspaceSummary }>(
    "/api/workspaces",
    "Failed to create workspace",
    { method: "POST", body: input },
  );
  return data.workspace;
}

export async function renameWorkspace(slug: string, name: string) {
  const data = await request<{ workspace: WorkspaceSummary }>(
    `/api/workspaces/${slug}`,
    "Failed to rename workspace",
    { method: "PATCH", body: { name } },
  );
  return data.workspace;
}

export function deleteWorkspace(slug: string) {
  return request(`/api/workspaces/${slug}`, "Failed to delete workspace", {
    method: "DELETE",
  });
}

export function leaveWorkspace(slug: string) {
  return request(`/api/workspaces/${slug}/leave`, "Failed to leave workspace", {
    method: "POST",
  });
}

export function updateMemberRole(slug: string, userId: string, role: Role) {
  return request(`/api/workspaces/${slug}/members/${userId}`, "Failed to change role", {
    method: "PATCH",
    body: { role },
  });
}

export function removeMember(slug: string, userId: string) {
  return request(`/api/workspaces/${slug}/members/${userId}`, "Failed to remove member", {
    method: "DELETE",
  });
}

export function setMemberProjects(slug: string, userId: string, projectIds: string[]) {
  return request(
    `/api/workspaces/${slug}/members/${userId}/projects`,
    "Failed to update project access",
    { method: "PUT", body: { projectIds } },
  );
}

export async function fetchInvites(slug: string) {
  const data = await request<{ invites: Invite[] }>(
    `/api/workspaces/${slug}/invites`,
    "Failed to load invites",
  );
  return data.invites;
}

export function createInvite(
  slug: string,
  input: { email?: string; role: Role; projectIds?: string[] },
) {
  return request<InviteResult>(`/api/workspaces/${slug}/invites`, "Failed to create invite", {
    method: "POST",
    body: input,
  });
}

export function revokeInvite(inviteId: string) {
  return request(`/api/invites/${inviteId}`, "Failed to revoke invite", { method: "DELETE" });
}

export function renewInvite(inviteId: string) {
  return request<InviteResult>(`/api/invites/${inviteId}/renew`, "Failed to renew invite", {
    method: "POST",
  });
}

export async function acceptInvite(token: string) {
  return request<{ slug: string }>("/api/invites/accept", "Failed to accept invite", {
    method: "POST",
    body: { token },
  });
}
