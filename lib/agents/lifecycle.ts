import type { AgentRunStatus, Prisma } from "@prisma/client";

import { claimTimeoutMinutes } from "@/lib/agents/config";
import { db } from "@/lib/db";
import { type ActivityAction, recordActivity } from "@/lib/services/activity";
import type { Ctx } from "@/lib/services/context";
import { moveIssue } from "@/lib/services/issues";

/** Runs that still hold the issue (docs/features/12-agents.md "Lifecycle"). */
export const ACTIVE_RUN: AgentRunStatus[] = ["QUEUED", "DISPATCHED", "RUNNING", "NEEDS_INPUT", "PR_OPEN"];

/** Ctx for the dispatcher and watchdog. */
export function dispatcherCtx(workspaceId: string): Ctx {
  return { actor: { type: "system" }, workspaceId, role: "MEMBER", via: "dispatcher" };
}

export async function recordRunActivity(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  run: { id: string; agentId: string; issueId: string },
  action: ActivityAction,
  data: Prisma.InputJsonObject = {},
) {
  const issue = await tx.issue.findUnique({ where: { id: run.issueId }, select: { projectId: true } });
  await recordActivity(tx, ctx, {
    action,
    projectId: issue?.projectId,
    issueId: run.issueId,
    data: { agentId: run.agentId, runId: run.id, ...data },
  });
}

/** Mark a run FAILED (only if it's still in one of `from`) and note it on the issue. */
export async function failRun(
  runId: string,
  error: string,
  from: AgentRunStatus[] = ACTIVE_RUN,
  ctx?: Ctx,
) {
  return db.$transaction(async (tx) => {
    const run = await tx.agentRun.findUnique({ where: { id: runId } });
    if (!run || !from.includes(run.status)) return false;
    const { count } = await tx.agentRun.updateMany({
      where: { id: runId, status: { in: from } },
      data: { status: "FAILED", error: error.slice(0, 500), finishedAt: new Date() },
    });
    if (!count) return false;
    await tx.issue.updateMany({
      where: { id: run.issueId, claimedByAgentId: run.agentId },
      data: { claimedByAgentId: null, claimedAt: null },
    });
    await recordRunActivity(tx, ctx ?? dispatcherCtx(run.workspaceId), run, "agent.failed", { error: error.slice(0, 500) });
    return true;
  });
}

/**
 * Watchdog: runs dispatched but not claimed within the timeout fail, freeing
 * the issue. Called by /api/cron/agent-watchdog and whenever runs are read.
 */
export async function failStaleRuns(now = new Date()) {
  const minutes = claimTimeoutMinutes();
  const cutoff = new Date(now.getTime() - minutes * 60_000);
  const stale = await db.agentRun.findMany({
    where: {
      OR: [
        { status: "QUEUED", createdAt: { lt: cutoff } },
        // A resumed run is dispatched again long after it was created.
        { status: "DISPATCHED", dispatchedAt: { lt: cutoff } },
        { status: "DISPATCHED", dispatchedAt: null, createdAt: { lt: cutoff } },
      ],
    },
    select: { id: true },
    take: 100,
  });
  let failed = 0;
  for (const run of stale) {
    if (await failRun(run.id, `Not claimed within ${minutes} minutes`, ["QUEUED", "DISPATCHED"])) failed++;
  }
  return failed;
}

const REVIEW_COLUMN = /^(in )?review$/i;

/**
 * GitHub linked a PR to an issue (lib/github/webhooks.ts). An open PR moves the
 * agent's run to PR_OPEN and the card to a "Review" column if the project has
 * one; a merged PR finishes the run.
 */
export async function onPullRequestLinked(ctx: Ctx, issueId: string, pr: { url: string; state: string }) {
  const run = await db.agentRun.findFirst({
    where: { issueId, status: { in: ACTIVE_RUN } },
    orderBy: { createdAt: "desc" },
  });
  if (!run) return;

  if (pr.state === "OPEN" && run.status !== "PR_OPEN") {
    await db.$transaction(async (tx) => {
      await tx.agentRun.update({ where: { id: run.id }, data: { status: "PR_OPEN", prUrl: pr.url } });
      await recordRunActivity(tx, ctx, run, "agent.pr_opened", { prUrl: pr.url });
    });
    const issue = await db.issue.findUnique({ where: { id: issueId }, select: { projectId: true, columnId: true } });
    const columns = issue
      ? await db.column.findMany({ where: { projectId: issue.projectId }, orderBy: { position: "asc" } })
      : [];
    const review = columns.find((c) => REVIEW_COLUMN.test(c.name.trim()));
    if (issue && review && review.id !== issue.columnId) {
      await moveIssue(ctx, { issueId, toColumnId: review.id, toPosition: 1_000_000 });
    }
    return;
  }

  if (pr.state === "MERGED") {
    await db.$transaction(async (tx) => {
      await tx.agentRun.update({
        where: { id: run.id },
        data: { status: "DONE", prUrl: run.prUrl ?? pr.url, finishedAt: new Date() },
      });
      await tx.issue.updateMany({
        where: { id: issueId, claimedByAgentId: run.agentId },
        data: { claimedByAgentId: null, claimedAt: null },
      });
      await recordRunActivity(tx, ctx, run, "agent.done", { prUrl: pr.url });
    });
  }
}
