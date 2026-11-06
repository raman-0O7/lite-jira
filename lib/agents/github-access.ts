import { DispatchError } from "@/lib/agents/http";
import { db } from "@/lib/db";
import { getApp, getInstallation, type GhApp, type GhPermissions, GitHubError, repoToken } from "@/lib/github/client";
import { GITHUB_WEB, githubConfigured } from "@/lib/github/config";

/**
 * The workspace agent's access to code goes through Kanso's GitHub App
 * (docs/features/18-workspace-agent.md "GitHub access"): each run's session
 * gets a token for its one repository that can only push, and Kanso opens the
 * pull request with another that can only open pull requests. Tokens last an
 * hour, so sessions get fresh ones as they go.
 */

/** The session's token: push to the issue's repository, nothing else. */
export const PUSH_PERMISSIONS: GhPermissions = { contents: "write", metadata: "read" };
/** Kanso's own token for opening the pull request. */
export const PULL_REQUEST_PERMISSIONS: GhPermissions = { pull_requests: "write", metadata: "read" };

const canWriteCode = (permissions: GhPermissions | undefined) =>
  permissions?.contents === "write" && permissions?.pull_requests === "write";

type InstallationRef = { installationId: number; accountLogin: string; accountType: string };

/** Where an account's owner reviews the app's permissions (and accepts updated ones). */
export const installationSettingsUrl = (i: InstallationRef) =>
  i.accountType === "Organization"
    ? `${GITHUB_WEB}/organizations/${encodeURIComponent(i.accountLogin)}/settings/installations/${i.installationId}`
    : `${GITHUB_WEB}/settings/installations/${i.installationId}`;

/** Where whoever runs Kanso changes the app's permissions. */
const appPermissionsUrl = (app: GhApp) =>
  app.owner?.type === "Organization"
    ? `${GITHUB_WEB}/organizations/${encodeURIComponent(app.owner.login)}/settings/apps/${app.slug}/permissions`
    : `${GITHUB_WEB}/settings/apps/${app.slug}/permissions`;

export const APP_NEEDS_ACCESS =
  "Kanso's GitHub App doesn't have access to code yet. Whoever runs Kanso needs to give it Contents and Pull requests (read and write) access on GitHub.";

/** The workspace's (unsuspended) installation that covers a repository. */
async function repoInstallation(workspaceId: string, repoFullName: string): Promise<InstallationRef | null> {
  const row = await db.projectRepo.findFirst({
    where: { repoFullName: repoFullName.toLowerCase(), project: { workspaceId }, installation: { suspendedAt: null } },
    select: { installation: { select: { installationId: true, accountLogin: true, accountType: true } } },
  });
  return row?.installation ?? null;
}

/**
 * A token for one repository with `permissions`. Throws a DispatchError whose
 * message says who can fix it: the account owner (accept the app's updated
 * permissions), or whoever runs Kanso (the app itself lacks them).
 */
export async function repoAccessToken(
  workspaceId: string,
  repoFullName: string,
  permissions: GhPermissions,
  doing: string,
) {
  const installation = await repoInstallation(workspaceId, repoFullName);
  if (!installation) throw new DispatchError(`${repoFullName} isn't connected through Kanso's GitHub App`);
  try {
    return await repoToken(installation.installationId, repoFullName, permissions);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    if (error.status === 422 && /permission/i.test(error.message)) {
      const app = await getApp().catch(() => null);
      if (app && !canWriteCode(app.permissions)) throw new DispatchError(APP_NEEDS_ACCESS);
      throw new DispatchError(
        `Kanso's GitHub App can't ${doing} ${repoFullName} yet. An owner of ${installation.accountLogin} needs to accept the app's updated permissions on GitHub.`,
      );
    }
    if (error.status === 422 || error.status === 404) {
      throw new DispatchError(`Kanso's GitHub App can't see ${repoFullName}. Add it to the app's repositories on GitHub.`);
    }
    if (error.status === 503) throw new DispatchError("GitHub isn't set up on this Kanso server");
    throw new DispatchError("Couldn't get access to the repository from GitHub; try again");
  }
}

export type WorkspaceAgentGitHub =
  /** This server has no GitHub App. */
  | { status: "not_configured" }
  /** The workspace hasn't installed it. */
  | { status: "not_connected" }
  /** The app itself doesn't ask for code access: whoever runs Kanso changes that. */
  | { status: "app_needs_access"; settingsUrl: string | null }
  /** GitHub didn't answer. */
  | { status: "unknown" }
  /** Per account: whether its owner has granted code access. */
  | { status: "ready" | "needs_approval"; accounts: { login: string; ready: boolean; settingsUrl: string }[] };

/** Whether the workspace agent can push and open pull requests in this workspace's GitHub accounts. */
export async function workspaceAgentGitHub(workspaceId: string): Promise<WorkspaceAgentGitHub> {
  if (!githubConfigured()) return { status: "not_configured" };
  const installations = await db.gitHubInstallation.findMany({
    where: { workspaceId, suspendedAt: null },
    orderBy: { createdAt: "asc" },
    select: { installationId: true, accountLogin: true, accountType: true },
  });
  if (!installations.length) return { status: "not_connected" };
  try {
    const app = await getApp();
    if (!canWriteCode(app.permissions)) return { status: "app_needs_access", settingsUrl: appPermissionsUrl(app) };
    const accounts = await Promise.all(
      installations.map(async (installation) => ({
        login: installation.accountLogin,
        ready: canWriteCode((await getInstallation(installation.installationId)).permissions),
        settingsUrl: installationSettingsUrl(installation),
      })),
    );
    return { status: accounts.every((a) => a.ready) ? "ready" : "needs_approval", accounts };
  } catch {
    return { status: "unknown" };
  }
}
