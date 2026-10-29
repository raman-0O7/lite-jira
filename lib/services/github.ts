import { type ColumnCategory, Prisma } from "@prisma/client";
import { z } from "zod";

import { appUrl } from "@/lib/app-url";
import { colorFor } from "@/lib/colors";
import { signState, verifyState } from "@/lib/crypto";
import { db } from "@/lib/db";
import { defer } from "@/lib/defer";
import * as gh from "@/lib/github/client";
import { githubConfigured } from "@/lib/github/config";
import { APP_NAME_MAX, appManifest, defaultAppName, envLines, isLocalOrigin, manifestFormAction } from "@/lib/github/manifest";
import { authorize, can } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { actingUserId, type Ctx, userCtx } from "@/lib/services/context";
import { badRequest, forbidden, notFound, ServiceError } from "@/lib/services/errors";
import { createImportedIssue, moveIssue } from "@/lib/services/issues";
import { projectScope } from "@/lib/services/scope";

/**
 * The GitHub App integration (docs/features/11-github-app.md): installing the
 * app into a workspace, linking people's GitHub accounts, connecting
 * repositories to projects, and importing assigned issues. Webhook handling
 * lives in lib/github/webhooks.ts and reuses the helpers exported here.
 */

export const githubCallbackUrl = () => `${appUrl()}/api/github/callback`;

function requireGitHub() {
  if (!githubConfigured()) throw new ServiceError(409, "The GitHub App isn't configured on this server");
}

/** GitHub API failures surface as a 400 with GitHub's message. */
async function ghCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof gh.GitHubError) throw badRequest(error.message);
    throw error;
  }
}

/** Ctx for writes made by GitHub sync (webhooks, imports). */
export function githubCtx(installation: { id: string; workspaceId: string }): Ctx {
  return {
    actor: { type: "github", installationId: installation.id },
    workspaceId: installation.workspaceId,
    role: "MEMBER",
    via: "github",
  };
}

// ---------- settings ----------

export async function getGitHubSettings(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  const userId = actingUserId(ctx);
  const link = userId
    ? await db.gitHubUserLink.findUnique({ where: { userId }, select: { login: true, createdAt: true } })
    : null;
  // Guests don't see the workspace's installations: repo connections name projects.
  const installations =
    ctx.role === "GUEST"
      ? []
      : await db.gitHubInstallation.findMany({
          where: { workspaceId: ctx.workspaceId },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            installationId: true,
            accountLogin: true,
            accountType: true,
            suspendedAt: true,
            createdAt: true,
            repos: {
              orderBy: { repoFullName: "asc" },
              select: {
                id: true,
                repoFullName: true,
                importAssigned: true,
                statusSync: true,
                moveOnMerge: true,
                project: { select: { id: true, name: true, key: true } },
              },
            },
          },
        });
  const configured = githubConfigured();
  const canManage = can(ctx, "integrations.manage");
  return {
    configured,
    canManage,
    // What the guided app setup needs (admins, before the app exists).
    setup: !configured && canManage ? { defaultName: defaultAppName(appUrl()), local: isLocalOrigin(appUrl()) } : null,
    link,
    installations,
  };
}

// ---------- guided app setup (docs/features/15-github-setup.md) ----------

type ManifestState = { kind: "manifest"; workspaceId: string; userId: string };

const appSetupSchema = z.object({
  name: z.string().trim().min(1, "Name the app").max(APP_NAME_MAX, `App names are at most ${APP_NAME_MAX} characters`),
  org: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, "That isn't a GitHub organization name")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  public: z.boolean().default(false),
});

/**
 * The manifest form to post to GitHub, which creates a GitHub App with every
 * setting filled in. Admins only, and only while the server has no app.
 */
export function startGitHubAppSetup(ctx: Ctx, slug: string, input: unknown) {
  authorize(ctx, "integrations.manage");
  if (githubConfigured()) throw new ServiceError(409, "This server already has a GitHub App");
  const { name, org, public: isPublic } = appSetupSchema.parse(input);
  const origin = appUrl();
  const state = signState({ kind: "manifest", workspaceId: ctx.workspaceId, userId: actingUserId(ctx)! }, 3600);
  const manifest = appManifest(origin, {
    name,
    public: isPublic,
    redirectUrl: `${origin}/${slug}/settings/integrations/github-app`,
  });
  return { action: manifestFormAction(state, org), manifest: JSON.stringify(manifest) };
}

/**
 * Trade GitHub's one-time code for the new app's credentials, as environment
 * variables for the operator to add to the server. Shown once; never stored
 * or logged: an app's credentials are instance-wide, so only whoever runs the
 * server can put them to use.
 */
export async function completeGitHubAppSetup(ctx: Ctx, input: unknown) {
  authorize(ctx, "integrations.manage");
  const { code, state } = z.object({ code: z.string().min(1).max(200), state: z.string().min(1) }).parse(input);
  const signed = verifyState<ManifestState>(state);
  if (signed?.kind !== "manifest" || signed.workspaceId !== ctx.workspaceId || signed.userId !== actingUserId(ctx)) {
    throw badRequest("This setup link has expired or wasn't started from your account. Start again from Integrations.");
  }
  let app: gh.GhManifestApp;
  try {
    app = await gh.convertManifestCode(code);
  } catch (error) {
    if (error instanceof gh.GitHubError && error.status === 404) {
      throw badRequest("GitHub has already handed these credentials over, or the link expired. Credentials are shown only once.");
    }
    if (error instanceof gh.GitHubError) throw badRequest("GitHub didn't hand over the app's credentials. Please try again.");
    throw error;
  }
  return {
    app: { name: app.name, slug: app.slug, url: app.html_url },
    env: envLines(app).join("\n"),
    webhookSecretMissing: !app.webhook_secret,
  };
}

// ---------- install & link ----------

type CallbackState = { kind: "install" | "link"; workspaceId: string; userId: string };

/** Where to send an admin to install the app on GitHub. */
export function startGitHubInstall(ctx: Ctx) {
  authorize(ctx, "integrations.manage");
  requireGitHub();
  const userId = actingUserId(ctx)!;
  return gh.installUrl(signState({ kind: "install", workspaceId: ctx.workspaceId, userId }));
}

/** Where to send a member to link their GitHub account. */
export function startGitHubLink(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  requireGitHub();
  const userId = actingUserId(ctx);
  if (!userId || ctx.actor.type !== "user") throw forbidden();
  return gh.userAuthorizeUrl(
    signState({ kind: "link", workspaceId: ctx.workspaceId, userId }),
    githubCallbackUrl(),
  );
}

const callbackSchema = z.object({
  code: z.string().min(1).nullish(),
  state: z.string().min(1).nullish(),
  installationId: z.coerce.number().int().positive().nullish(),
  setupAction: z.string().nullish(),
});

/**
 * GitHub's redirect back to /api/github/callback, for the signed-in user.
 * Always links the user's GitHub account; for an install, also attaches the
 * installation to the workspace named in the signed state.
 */
export async function completeGitHubCallback(userId: string, input: unknown) {
  requireGitHub();
  const { code, state, installationId, setupAction } = callbackSchema.parse(input);
  const signed = state ? verifyState<CallbackState>(state) : null;
  if (!signed || signed.userId !== userId || (signed.kind !== "install" && signed.kind !== "link")) {
    throw badRequest("This GitHub request has expired or wasn't started from your account. Please try again.");
  }
  const membership = await db.membership.findUnique({
    where: { workspaceId_userId: { workspaceId: signed.workspaceId, userId } },
    select: { role: true },
  });
  if (!membership) throw notFound("Workspace not found");
  const ctx = userCtx(userId, signed.workspaceId, membership.role);

  // An install request awaiting an org owner's approval comes back without a code.
  if (setupAction === "request" && !installationId) return { workspaceId: ctx.workspaceId, result: "requested" as const };
  if (!code) throw badRequest("GitHub didn't return an authorization code");

  // The user token lives only for this request.
  const token = await ghCall(() => gh.exchangeUserCode(code, githubCallbackUrl()));
  const githubUser = await ghCall(() => gh.getAuthenticatedUser(token));
  await assertLinkable(userId, githubUser);

  let result: "installed" | "linked" = "linked";
  if (signed.kind === "install" && installationId) {
    authorize(ctx, "integrations.manage");
    if (!(await ghCall(() => gh.userCanSeeInstallation(token, installationId)))) {
      throw forbidden("Your GitHub account can't access that installation");
    }
    const info = await ghCall(() => gh.getInstallation(installationId));
    await attachInstallation(ctx, installationId, info);
    result = "installed";
  }
  await saveLink(userId, githubUser);
  return { workspaceId: ctx.workspaceId, result };
}

/** One GitHub account maps to one Kanso user. */
async function assertLinkable(userId: string, githubUser: gh.GhUser) {
  const taken = await db.gitHubUserLink.findUnique({
    where: { githubUserId: githubUser.id },
    select: { userId: true },
  });
  if (taken && taken.userId !== userId) {
    throw new ServiceError(409, `GitHub account @${githubUser.login} is already linked to another Kanso user`);
  }
}

async function saveLink(userId: string, githubUser: gh.GhUser) {
  await db.gitHubUserLink.upsert({
    where: { userId },
    create: { userId, githubUserId: githubUser.id, login: githubUser.login },
    update: { githubUserId: githubUser.id, login: githubUser.login },
  });
}

async function attachInstallation(ctx: Ctx, installationId: number, info: gh.GhInstallation) {
  const existing = await db.gitHubInstallation.findUnique({
    where: { installationId },
    select: { id: true, workspaceId: true },
  });
  if (existing && existing.workspaceId !== ctx.workspaceId) {
    throw new ServiceError(409, "That GitHub installation is already connected to another workspace");
  }
  const account = { accountLogin: info.account?.login ?? "unknown", accountType: info.account?.type ?? "User" };
  if (existing) {
    await db.gitHubInstallation.update({ where: { id: existing.id }, data: { ...account, suspendedAt: null } });
    return;
  }
  await db.$transaction(async (tx) => {
    await tx.gitHubInstallation.create({
      data: { workspaceId: ctx.workspaceId, installationId, createdById: actingUserId(ctx), ...account },
    });
    await recordActivity(tx, ctx, { action: "github.installed", data: { account: account.accountLogin } });
  });
}

export async function unlinkGitHub(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  if (ctx.actor.type !== "user") throw forbidden();
  await db.gitHubUserLink.deleteMany({ where: { userId: ctx.actor.userId } });
}

async function findInstallation(ctx: Ctx, id: string) {
  const installation = await db.gitHubInstallation.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, workspaceId: true, installationId: true, accountLogin: true, suspendedAt: true },
  });
  if (!installation) throw notFound("Installation not found");
  return installation;
}

/** Forget an installation in Kanso. (Uninstalling on GitHub is the user's step.) */
export async function removeInstallation(ctx: Ctx, id: string) {
  authorize(ctx, "integrations.manage");
  const installation = await findInstallation(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.gitHubInstallation.delete({ where: { id: installation.id } });
    await recordActivity(tx, ctx, { action: "github.uninstalled", data: { account: installation.accountLogin } });
  });
}

// ---------- repositories ----------

export async function listInstallationRepos(ctx: Ctx, id: string) {
  authorize(ctx, "integrations.manage");
  requireGitHub();
  const installation = await findInstallation(ctx, id);
  const repos = await ghCall(() => gh.listInstallationRepos(installation.installationId));
  const names = repos.map((r) => r.full_name.toLowerCase());
  const connected = await db.projectRepo.findMany({
    where: { repoFullName: { in: names } },
    select: { repoFullName: true, project: { select: { id: true, name: true, key: true, workspaceId: true } } },
  });
  const byName = new Map(connected.map((c) => [c.repoFullName, c.project]));
  return repos.map((repo) => {
    const project = byName.get(repo.full_name.toLowerCase());
    return {
      fullName: repo.full_name,
      private: repo.private,
      connected: project
        ? project.workspaceId === ctx.workspaceId
          ? { id: project.id, name: project.name, key: project.key }
          : { elsewhere: true as const }
        : null,
    };
  });
}

const repoToggles = {
  importAssigned: z.boolean().optional(),
  statusSync: z.boolean().optional(),
  moveOnMerge: z.boolean().optional(),
};

const connectRepoSchema = z.object({
  installationId: z.string().min(1),
  repoFullName: z
    .string()
    .trim()
    .regex(/^[\w.-]+\/[\w.-]+$/, "Use owner/name"),
  projectId: z.string().min(1),
  ...repoToggles,
});

const repoSelect = {
  id: true,
  repoFullName: true,
  importAssigned: true,
  statusSync: true,
  moveOnMerge: true,
  project: { select: { id: true, name: true, key: true } },
} satisfies Prisma.ProjectRepoSelect;

export async function connectRepo(ctx: Ctx, input: unknown) {
  authorize(ctx, "integrations.manage");
  requireGitHub();
  const { installationId, repoFullName, projectId, ...toggles } = connectRepoSchema.parse(input);
  const installation = await findInstallation(ctx, installationId);
  const project = await db.project.findFirst({ where: { id: projectId, ...projectScope(ctx) }, select: { id: true } });
  if (!project) throw notFound("Project not found");

  const repo = repoFullName.toLowerCase();
  const available = await ghCall(() => gh.listInstallationRepos(installation.installationId));
  if (!available.some((r) => r.full_name.toLowerCase() === repo)) {
    throw badRequest(`@${installation.accountLogin}'s installation doesn't include ${repoFullName}`);
  }
  if (await db.projectRepo.findFirst({ where: { repoFullName: repo }, select: { id: true } })) {
    throw new ServiceError(409, `${repoFullName} is already connected to a project`);
  }

  const row = await db.$transaction(async (tx) => {
    const created = await tx.projectRepo.create({
      data: { projectId, installationId: installation.id, repoFullName: repo, ...toggles },
      select: repoSelect,
    });
    await recordActivity(tx, ctx, { action: "github.repo_connected", projectId, data: { repo } });
    return created;
  });
  if (row.importAssigned) {
    defer("github.import", () => importAssignedIssues(row.id));
  }
  return row;
}

async function findProjectRepo(ctx: Ctx, id: string) {
  const row = await db.projectRepo.findFirst({
    where: { id, project: projectScope(ctx) },
    select: { id: true, projectId: true, repoFullName: true },
  });
  if (!row) throw notFound("Repository connection not found");
  return row;
}

export async function updateProjectRepo(ctx: Ctx, id: string, input: unknown) {
  authorize(ctx, "integrations.manage");
  const patch = z.object(repoToggles).parse(input);
  const row = await findProjectRepo(ctx, id);
  return db.$transaction(async (tx) => {
    const updated = await tx.projectRepo.update({ where: { id: row.id }, data: patch, select: repoSelect });
    await recordActivity(tx, ctx, {
      action: "github.repo_updated",
      projectId: row.projectId,
      data: { repo: row.repoFullName, ...patch },
    });
    return updated;
  });
}

export async function disconnectRepo(ctx: Ctx, id: string) {
  authorize(ctx, "integrations.manage");
  const row = await findProjectRepo(ctx, id);
  await db.$transaction(async (tx) => {
    await tx.projectRepo.delete({ where: { id: row.id } });
    await recordActivity(tx, ctx, {
      action: "github.repo_disconnected",
      projectId: row.projectId,
      data: { repo: row.repoFullName },
    });
  });
}

/** "Sync now": import assigned issues for one connected repository. */
export async function syncProjectRepo(ctx: Ctx, id: string) {
  authorize(ctx, "issue.write");
  requireGitHub();
  const row = await findProjectRepo(ctx, id);
  return ghCall(() => importAssignedIssues(row.id));
}

// ---------- import ----------

/** Import every open issue assigned to a linked member, for one connected repo. */
export async function importAssignedIssues(projectRepoId: string) {
  const repo = await db.projectRepo.findUnique({
    where: { id: projectRepoId },
    include: { installation: true },
  });
  if (!repo || repo.installation.suspendedAt) return { imported: 0 };
  const members = await linkedMembers(repo.installation.workspaceId);
  const ctx = githubCtx(repo.installation);
  let imported = 0;
  for (const member of members) {
    const issues = await gh.listAssignedIssues(repo.installation.installationId, repo.repoFullName, member.login);
    for (const issue of issues) {
      if (await importGitHubIssue(ctx, repo, issue, member.userId)) imported++;
    }
  }
  return { imported };
}

/** Non-guest members of a workspace with a linked GitHub account. */
export async function linkedMembers(workspaceId: string, githubUserIds?: number[]) {
  const links = await db.gitHubUserLink.findMany({
    where: {
      ...(githubUserIds ? { githubUserId: { in: githubUserIds } } : {}),
      user: { memberships: { some: { workspaceId, role: { not: "GUEST" } } } },
    },
    select: { userId: true, login: true, githubUserId: true },
  });
  return links;
}

/** The first column of a category, by position (falls back to the first column). */
export async function firstColumn(projectId: string, category: ColumnCategory) {
  const columns = await db.column.findMany({
    where: { projectId },
    orderBy: { position: "asc" },
    select: { id: true, category: true },
  });
  return columns.find((c) => c.category === category) ?? (category === "TODO" ? columns[0] : undefined);
}

/** Labels by name (case-insensitive), creating missing ones with GitHub's colour. */
async function ensureLabels(projectId: string, labels: gh.GhIssue["labels"] = []) {
  const wanted = labels
    .map((l) => (typeof l === "string" ? { name: l, color: "" } : l))
    .map((l) => ({ name: l.name.trim().slice(0, 50), color: l.color }))
    .filter((l) => l.name)
    .slice(0, 10);
  if (!wanted.length) return [];
  const existing = await db.label.findMany({ where: { projectId }, select: { id: true, name: true } });
  const ids: string[] = [];
  for (const label of wanted) {
    const match = existing.find((e) => e.name.toLowerCase() === label.name.toLowerCase());
    if (match) {
      ids.push(match.id);
      continue;
    }
    const color = /^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : colorFor(label.name);
    const created = await db.label.create({ data: { projectId, name: label.name, color }, select: { id: true, name: true } });
    existing.push(created);
    ids.push(created.id);
  }
  return [...new Set(ids)];
}

/** Import one GitHub issue into a connected repo's project. Null if already linked. */
export async function importGitHubIssue(
  ctx: Ctx,
  repo: { id: string; projectId: string; repoFullName: string },
  issue: gh.GhIssue,
  assigneeUserId: string,
) {
  if (issue.pull_request || issue.state !== "open") return null;
  const linked = await db.gitHubIssueLink.findUnique({
    where: { repoFullName_number: { repoFullName: repo.repoFullName, number: issue.number } },
    select: { id: true },
  });
  if (linked) return null;
  const column = await firstColumn(repo.projectId, "TODO");
  if (!column) return null;
  return createImportedIssue(ctx, {
    projectId: repo.projectId,
    columnId: column.id,
    title: issue.title,
    description: issue.body,
    assigneeUserId,
    labelIds: await ensureLabels(repo.projectId, issue.labels),
    link: { projectRepoId: repo.id, repoFullName: repo.repoFullName, number: issue.number, url: issue.html_url },
  });
}

/**
 * Move an issue to the first column of a category, unless it's already in one
 * (or, with `onlyFrom`, unless it's in a column of another category).
 */
export async function moveToCategory(
  ctx: Ctx,
  issueId: string,
  category: ColumnCategory,
  onlyFrom?: ColumnCategory[],
) {
  const issue = await db.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true, column: { select: { category: true } } },
  });
  if (!issue || issue.column.category === category) return false;
  if (onlyFrom && !onlyFrom.includes(issue.column.category)) return false;
  const column = await firstColumn(issue.projectId, category);
  if (!column) return false;
  await moveIssue(ctx, { issueId, toColumnId: column.id, toPosition: 1_000_000 });
  return true;
}

export function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
