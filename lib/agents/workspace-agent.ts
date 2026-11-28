import { forwardComment, reconcileActiveRuns, renewGitHubAccess } from "@/lib/agents/claude-api";
import { interruptRunSessions as interruptClaudeSessions } from "@/lib/agents/claude-api-client";
import {
  cancelOpenAiRuns,
  forwardOpenAiComment,
  reconcileOpenAiRuns,
  renewOpenAiGitHubAccess,
} from "@/lib/agents/openai-api";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/services/context";

/**
 * The workspace agent, whichever provider runs it
 * (docs/features/25-workspace-agent-openai.md "Code"): the rest of Kanso calls
 * these, and each passes the call to Claude Managed Agents (feature 18) or
 * OpenAI's Agents API (feature 25) by the agent's kind.
 */

/** Reconcile active workspace-agent runs on an issue, for an agent, or all of them (the cron). */
export async function reconcileWorkspaceRuns(where: { issueId?: string; agentId?: string } = {}, options?: { force?: boolean }) {
  const claude = await reconcileActiveRuns(where, options);
  const openai = await reconcileOpenAiRuns(where, options);
  return claude + openai;
}

/** Renew GitHub access for a run or an agent's runs, on either provider. */
export async function renewWorkspaceGitHubAccess(where: { runId?: string; agentId?: string }) {
  await renewGitHubAccess(where);
  await renewOpenAiGitHubAccess(where);
}

/** Send a teammate's comment into the run's session. */
export async function forwardWorkspaceComment(ctx: Ctx, runId: string, commentId: string) {
  const run = await db.agentRun.findUnique({ where: { id: runId }, select: { agent: { select: { kind: true } } } });
  if (run?.agent.kind === "OPENAI_API") return forwardOpenAiComment(ctx, runId, commentId);
  if (run?.agent.kind === "CLAUDE_API") return forwardComment(ctx, runId, commentId);
}

/** Stop the sessions of these runs, whichever provider they're on. */
export async function interruptRunSessions(runIds: string[]) {
  await interruptClaudeSessions(runIds);
  await cancelOpenAiRuns(runIds);
}
