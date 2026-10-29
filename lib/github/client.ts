import { createSign } from "node:crypto";

import { GITHUB_API, GITHUB_WEB, githubAppConfig, type GitHubAppConfig } from "@/lib/github/config";

/**
 * A thin GitHub REST client. Kanso acts as the app (JWT) or as an installation
 * (short-lived installation token, cached in memory, never stored). User
 * tokens exist only for the duration of the link callback.
 *
 * `fetch` is swappable so tests run against a fake GitHub.
 */

type Fetch = typeof fetch;
let fetchImpl: Fetch = (...args) => fetch(...args);

export function setGitHubFetch(impl: Fetch | null) {
  fetchImpl = impl ?? ((...args) => fetch(...args));
  tokenCache.clear();
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

function requireConfig(): GitHubAppConfig {
  const config = githubAppConfig();
  if (!config) throw new GitHubError(503, "The GitHub App isn't configured");
  return config;
}

/** A 9-minute RS256 JWT identifying the app. */
export function appJwt(config = requireConfig(), now = Math.floor(Date.now() / 1000)): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: now - 60, exp: now + 540, iss: config.appId })}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(config.privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function call<T>(
  url: string,
  init: { token: string; scheme?: "Bearer" | "token"; method?: string; body?: unknown },
): Promise<T> {
  const response = await fetchImpl(url.startsWith("http") ? url : `${GITHUB_API}${url}`, {
    method: init.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `${init.scheme ?? "Bearer"} ${init.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Kanso",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = ((await response.json()) as { message?: string }).message ?? message;
    } catch {}
    throw new GitHubError(response.status, `GitHub: ${message}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---------- installation tokens ----------

const tokenCache = new Map<number, { token: string; expiresAt: number }>();

export async function installationToken(installationId: number): Promise<string> {
  const cached = tokenCache.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;
  const data = await call<{ token: string; expires_at: string }>(
    `/app/installations/${installationId}/access_tokens`,
    { token: appJwt(), method: "POST" },
  );
  tokenCache.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) });
  return data.token;
}

const asInstallation = async <T>(installationId: number, path: string, method = "GET", body?: unknown) =>
  call<T>(path, { token: await installationToken(installationId), method, body });

// ---------- shapes (only the fields Kanso reads) ----------

export type GhUser = { id: number; login: string };
export type GhLabel = { name: string; color: string };
export type GhIssue = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  node_id?: string;
  assignees?: GhUser[];
  labels?: (GhLabel | string)[];
  pull_request?: unknown;
};
export type GhInstallation = { id: number; account: { login: string; type: string } | null };
export type GhRepo = { full_name: string; private: boolean };
export type GhCheckSuite = { status: string | null; conclusion: string | null; latest_check_runs_count?: number };

// ---------- app & installation calls ----------

export const getInstallation = (installationId: number) =>
  call<GhInstallation>(`/app/installations/${installationId}`, { token: appJwt() });

export async function listInstallationRepos(installationId: number): Promise<GhRepo[]> {
  const repos: GhRepo[] = [];
  for (let page = 1; page <= 10; page++) {
    const data = await asInstallation<{ repositories: GhRepo[] }>(
      installationId,
      `/installation/repositories?per_page=100&page=${page}`,
    );
    repos.push(...data.repositories);
    if (data.repositories.length < 100) break;
  }
  return repos;
}

/** Open issues (not PRs) in a repo assigned to `login`. */
export async function listAssignedIssues(installationId: number, repo: string, login: string): Promise<GhIssue[]> {
  const data = await asInstallation<GhIssue[]>(
    installationId,
    `/repos/${repo}/issues?state=open&assignee=${encodeURIComponent(login)}&per_page=100`,
  );
  return data.filter((issue) => !issue.pull_request);
}

export const setIssueState = (installationId: number, repo: string, number: number, state: "open" | "closed") =>
  asInstallation(installationId, `/repos/${repo}/issues/${number}`, "PATCH", {
    state,
    ...(state === "closed" ? { state_reason: "completed" } : {}),
  });

export async function checkSuites(installationId: number, repo: string, sha: string): Promise<GhCheckSuite[]> {
  const data = await asInstallation<{ check_suites: GhCheckSuite[] }>(
    installationId,
    `/repos/${repo}/commits/${sha}/check-suites?per_page=100`,
  );
  return data.check_suites;
}

// ---------- app manifest (guided setup) ----------

/** What GitHub returns once for an app created from a manifest. */
export type GhManifestApp = {
  id: number;
  slug: string;
  name: string;
  html_url: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string | null;
  pem: string;
};

/** Trade the manifest flow's one-time code for the new app's credentials (no auth needed). */
export async function convertManifestCode(code: string): Promise<GhManifestApp> {
  const response = await fetchImpl(`${GITHUB_API}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Kanso" },
  });
  if (!response.ok) {
    throw new GitHubError(response.status, response.status === 404 ? "GitHub: code not found" : `GitHub: ${response.statusText}`);
  }
  return (await response.json()) as GhManifestApp;
}

// ---------- user OAuth (link callback only) ----------

export function userAuthorizeUrl(state: string, redirectUri: string) {
  const config = requireConfig();
  const url = new URL(`${GITHUB_WEB}/login/oauth/authorize`);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function installUrl(state: string) {
  const url = new URL(`${GITHUB_WEB}/apps/${requireConfig().slug}/installations/new`);
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeUserCode(code: string, redirectUri: string): Promise<string> {
  const config = requireConfig();
  const response = await fetchImpl(`${GITHUB_WEB}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "Kanso" },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { access_token?: string; error_description?: string };
  if (!response.ok || !data.access_token) {
    throw new GitHubError(400, `GitHub: ${data.error_description ?? "could not authorize"}`);
  }
  return data.access_token;
}

export const getAuthenticatedUser = (userToken: string) => call<GhUser>("/user", { token: userToken });

export async function userCanSeeInstallation(userToken: string, installationId: number): Promise<boolean> {
  for (let page = 1; page <= 10; page++) {
    const data = await call<{ installations: { id: number }[] }>(`/user/installations?per_page=100&page=${page}`, {
      token: userToken,
    });
    if (data.installations.some((i) => i.id === installationId)) return true;
    if (data.installations.length < 100) return false;
  }
  return false;
}
