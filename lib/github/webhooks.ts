import type { ChecksState, PullRequestState } from "@prisma/client";
import { z } from "zod";

import { onPullRequestLinked } from "@/lib/agents/lifecycle";
import { db } from "@/lib/db";
import { checkSuites, type GhCheckSuite } from "@/lib/github/client";
import { parseKey } from "@/lib/services/issue-shapes";
import {
  githubCtx,
  importGitHubIssue,
  linkedMembers,
  moveToCategory,
} from "@/lib/services/github";
import { updateIssue } from "@/lib/services/issues";

/**
 * GitHub → Kanso (docs/features/11-github-app.md "Webhooks"). The route has
 * already verified the signature and deduplicated the delivery. Payloads are
 * untrusted input: parsed with Zod, stored as plain data, never interpreted.
 */

export const HANDLED_EVENTS = new Set([
  "installation",
  "installation_repositories",
  "issues",
  "pull_request",
  "check_suite",
]);

const account = z.object({ login: z.string(), type: z.string().optional() }).nullish();
const installationRef = z.object({ id: z.number(), account });
const repository = z.object({ full_name: z.string() });
const ghUser = z.object({ id: z.number(), login: z.string() });
const label = z.union([z.string(), z.object({ name: z.string(), color: z.string().default("") })]);

const issuePayload = z.object({
  action: z.string(),
  installation: installationRef,
  repository,
  changes: z.record(z.string(), z.unknown()).optional(),
  issue: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string(),
    state: z.enum(["open", "closed"]),
    assignees: z.array(ghUser).default([]),
    labels: z.array(label).default([]),
    pull_request: z.unknown().optional(),
  }),
});

const pullRequestPayload = z.object({
  action: z.string(),
  installation: installationRef,
  repository,
  pull_request: z.object({
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    html_url: z.string(),
    state: z.enum(["open", "closed"]),
    merged: z.boolean().nullish(),
    merged_at: z.string().nullish(),
    head: z.object({ ref: z.string(), sha: z.string() }),
  }),
});

const checkSuitePayload = z.object({
  action: z.string(),
  installation: installationRef,
  repository,
  check_suite: z.object({ head_sha: z.string() }),
});

const installationPayload = z.object({ action: z.string(), installation: installationRef });

const installationReposPayload = z.object({
  action: z.string(),
  installation: installationRef,
  repositories_removed: z.array(repository).default([]),
});

export async function handleGitHubWebhook(event: string, payload: unknown) {
  switch (event) {
    case "installation":
      return onInstallation(installationPayload.parse(payload));
    case "installation_repositories":
      return onInstallationRepos(installationReposPayload.parse(payload));
    case "issues":
      return onIssue(issuePayload.parse(payload));
    case "pull_request":
      return onPullRequest(pullRequestPayload.parse(payload));
    case "check_suite":
      return onCheckSuite(checkSuitePayload.parse(payload));
  }
}

async function installationFor(id: number) {
  return db.gitHubInstallation.findUnique({
    where: { installationId: id },
    select: { id: true, workspaceId: true, installationId: true, suspendedAt: true },
  });
}

// ---------- installation ----------

async function onInstallation(payload: z.infer<typeof installationPayload>) {
  const where = { installationId: payload.installation.id };
  switch (payload.action) {
    case "deleted":
      // Repo connections cascade; issue and PR links stay so history survives.
      await db.gitHubInstallation.deleteMany({ where });
      return;
    case "suspend":
      await db.gitHubInstallation.updateMany({ where, data: { suspendedAt: new Date() } });
      return;
    case "unsuspend":
      await db.gitHubInstallation.updateMany({ where, data: { suspendedAt: null } });
      return;
  }
}

async function onInstallationRepos(payload: z.infer<typeof installationReposPayload>) {
  if (payload.action !== "removed") return;
  const installation = await installationFor(payload.installation.id);
  if (!installation) return;
  await db.projectRepo.deleteMany({
    where: {
      installationId: installation.id,
      repoFullName: { in: payload.repositories_removed.map((r) => r.full_name.toLowerCase()) },
    },
  });
}

// ---------- issues ----------

async function onIssue(payload: z.infer<typeof issuePayload>) {
  const installation = await installationFor(payload.installation.id);
  if (!installation || installation.suspendedAt) return;
  const ctx = githubCtx(installation);
  const repoFullName = payload.repository.full_name.toLowerCase();
  const { issue } = payload;

  if (payload.action === "opened" || payload.action === "assigned") {
    const repo = await db.projectRepo.findUnique({
      where: { installationId_repoFullName: { installationId: installation.id, repoFullName } },
      select: { id: true, projectId: true, repoFullName: true, importAssigned: true },
    });
    if (!repo?.importAssigned || issue.pull_request) return;
    const [member] = await linkedMembers(
      installation.workspaceId,
      issue.assignees.map((a) => a.id),
    );
    if (member) await importGitHubIssue(ctx, repo, issue, member.userId);
    return;
  }

  const link = await db.gitHubIssueLink.findUnique({
    where: { repoFullName_number: { repoFullName, number: issue.number } },
    select: {
      id: true,
      issueId: true,
      issue: { select: { project: { select: { workspaceId: true } } } },
      projectRepo: { select: { statusSync: true } },
    },
  });
  // Only issues imported into this installation's workspace.
  if (!link || link.issue.project.workspaceId !== installation.workspaceId) return;

  if (payload.action === "closed" || payload.action === "reopened") {
    const closed = payload.action === "closed";
    await db.gitHubIssueLink.update({
      where: { id: link.id },
      data: { state: closed ? "CLOSED" : "OPEN", lastSyncedAt: new Date() },
    });
    if (link.projectRepo?.statusSync) {
      await moveToCategory(ctx, link.issueId, closed ? "DONE" : "TODO");
    }
    return;
  }

  if (payload.action === "edited") {
    const changed = payload.changes ?? {};
    const patch: { title?: string; description?: string | null } = {};
    if ("title" in changed) patch.title = issue.title.trim().slice(0, 200) || `#${issue.number}`;
    if ("body" in changed) patch.description = issue.body?.slice(0, 10_000) || null;
    if (Object.keys(patch).length) {
      await updateIssue(ctx, link.issueId, patch);
      await db.gitHubIssueLink.update({ where: { id: link.id }, data: { lastSyncedAt: new Date() } });
    }
  }
}

// ---------- pull requests ----------

const KEY_PATTERN = /\b([A-Za-z][A-Za-z0-9]{1,9}-\d{1,9})\b/g;

/** Distinct issue keys mentioned in a branch name, title, or body (max 10). */
export function extractIssueKeys(...texts: (string | null | undefined)[]) {
  const keys = new Set<string>();
  for (const text of texts) {
    for (const match of (text ?? "").matchAll(KEY_PATTERN)) {
      const parsed = parseKey(match[1]!);
      if (parsed) keys.add(`${parsed.projectKey}-${parsed.number}`);
      if (keys.size >= 10) return [...keys];
    }
  }
  return [...keys];
}

async function onPullRequest(payload: z.infer<typeof pullRequestPayload>) {
  if (!["opened", "edited", "reopened", "synchronize", "closed", "ready_for_review"].includes(payload.action)) return;
  const installation = await installationFor(payload.installation.id);
  if (!installation || installation.suspendedAt) return;
  const repoFullName = payload.repository.full_name.toLowerCase();
  // Only repositories connected to a project in this workspace.
  const repo = await db.projectRepo.findUnique({
    where: { installationId_repoFullName: { installationId: installation.id, repoFullName } },
    select: { moveOnMerge: true },
  });
  if (!repo) return;

  const pr = payload.pull_request;
  const state: PullRequestState = pr.merged ? "MERGED" : pr.state === "closed" ? "CLOSED" : "OPEN";
  const ctx = githubCtx(installation);

  for (const key of extractIssueKeys(pr.head.ref, pr.title, pr.body)) {
    const parsed = parseKey(key)!;
    const issue = await db.issue.findFirst({
      where: { number: parsed.number, project: { workspaceId: installation.workspaceId, key: parsed.projectKey } },
      select: { id: true },
    });
    if (!issue) continue;

    const where = { issueId_repoFullName_number: { issueId: issue.id, repoFullName, number: pr.number } };
    const existing = await db.pullRequestLink.findUnique({ where, select: { headSha: true } });
    const fields = {
      url: pr.html_url,
      title: pr.title.slice(0, 300),
      branch: pr.head.ref.slice(0, 255),
      headSha: pr.head.sha,
      state,
      mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
    };
    const link = await db.pullRequestLink.upsert({
      where,
      create: { issueId: issue.id, repoFullName, number: pr.number, ...fields },
      // A new head commit hasn't been checked yet.
      update: { ...fields, ...(existing?.headSha !== pr.head.sha ? { checks: "NONE" as const } : {}) },
      select: { url: true, state: true },
    });

    await onPullRequestLinked(ctx, issue.id, link);

    if (state === "MERGED" && repo.moveOnMerge) {
      await moveToCategory(ctx, issue.id, "DONE");
    }
  }
}

// ---------- checks ----------

const FAILED = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);

/** One status for a commit's check suites. Suites with no runs are ignored. */
export function combineChecks(suites: GhCheckSuite[]): ChecksState {
  const relevant = suites.filter((s) => (s.latest_check_runs_count ?? 1) > 0);
  if (!relevant.length) return "NONE";
  if (relevant.some((s) => s.conclusion && FAILED.has(s.conclusion))) return "FAIL";
  if (relevant.some((s) => s.status !== "completed")) return "PENDING";
  return "PASS";
}

async function onCheckSuite(payload: z.infer<typeof checkSuitePayload>) {
  if (payload.action !== "completed") return;
  const installation = await installationFor(payload.installation.id);
  if (!installation || installation.suspendedAt) return;
  const repoFullName = payload.repository.full_name.toLowerCase();
  const sha = payload.check_suite.head_sha;
  const where = { repoFullName, headSha: sha, issue: { project: { workspaceId: installation.workspaceId } } };
  if (!(await db.pullRequestLink.count({ where }))) return;
  const checks = combineChecks(await checkSuites(installation.installationId, repoFullName, sha));
  await db.pullRequestLink.updateMany({ where, data: { checks } });
}
