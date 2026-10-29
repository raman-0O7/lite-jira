import { request } from "@/lib/api/http";

export type RepoToggles = { importAssigned: boolean; statusSync: boolean; moveOnMerge: boolean };

export type ConnectedRepo = RepoToggles & {
  id: string;
  repoFullName: string;
  project: { id: string; name: string; key: string };
};

export type GitHubInstallation = {
  id: string;
  installationId: number;
  accountLogin: string;
  accountType: string;
  suspendedAt: string | null;
  createdAt: string;
  repos: ConnectedRepo[];
};

export type GitHubSettings = {
  configured: boolean;
  canManage: boolean;
  setup: { defaultName: string; local: boolean } | null;
  link: { login: string; createdAt: string } | null;
  installations: GitHubInstallation[];
};

export type InstallationRepo = {
  fullName: string;
  private: boolean;
  connected: { id: string; name: string; key: string } | { elsewhere: true } | null;
};

export const githubKeys = {
  settings: (slug: string) => ["github", slug] as const,
  repos: (slug: string, installationId: string) => ["github", slug, "repos", installationId] as const,
};

const base = (slug: string) => `/api/workspaces/${slug}/github`;

export const fetchGitHubSettings = (slug: string) =>
  request<GitHubSettings>(base(slug), "Failed to load GitHub settings");

export async function fetchInstallationRepos(slug: string, installationId: string) {
  const data = await request<{ repos: InstallationRepo[] }>(
    `${base(slug)}/installations/${installationId}/repos`,
    "Failed to load repositories",
  );
  return data.repos;
}

export const startInstall = (slug: string) =>
  request<{ url: string }>(`${base(slug)}/install`, "Couldn’t start the install", { method: "POST" });

export const startLink = (slug: string) =>
  request<{ url: string }>(`${base(slug)}/link`, "Couldn’t start linking", { method: "POST" });

export const unlink = (slug: string) =>
  request(`${base(slug)}/link`, "Couldn’t unlink", { method: "DELETE" });

export const removeInstallation = (slug: string, id: string) =>
  request(`${base(slug)}/installations/${id}`, "Couldn’t remove the installation", { method: "DELETE" });

export const connectRepo = (
  slug: string,
  input: { installationId: string; repoFullName: string; projectId: string } & Partial<RepoToggles>,
) => request<{ repo: ConnectedRepo }>(`${base(slug)}/repos`, "Couldn’t connect the repository", { method: "POST", body: input });

export const updateRepo = (slug: string, id: string, patch: Partial<RepoToggles>) =>
  request<{ repo: ConnectedRepo }>(`${base(slug)}/repos/${id}`, "Couldn’t update the repository", {
    method: "PATCH",
    body: patch,
  });

export const disconnectRepo = (slug: string, id: string) =>
  request(`${base(slug)}/repos/${id}`, "Couldn’t disconnect the repository", { method: "DELETE" });

export const syncRepo = (slug: string, id: string) =>
  request<{ imported: number }>(`${base(slug)}/repos/${id}/sync`, "Sync failed", { method: "POST" });

export type GitHubAppSetupInput = { name: string; org: string; public: boolean };

export const startAppSetup = (slug: string, input: GitHubAppSetupInput) =>
  request<{ action: string; manifest: string }>(`${base(slug)}/app`, "Couldn’t start creating the app", {
    method: "POST",
    body: input,
  });

export type CreatedGitHubApp = {
  app: { name: string; slug: string; url: string };
  env: string;
  webhookSecretMissing: boolean;
};

export const completeAppSetup = (slug: string, input: { code: string; state: string }) =>
  request<CreatedGitHubApp>(`${base(slug)}/app/complete`, "Couldn’t get the app’s credentials", {
    method: "POST",
    body: input,
  });
