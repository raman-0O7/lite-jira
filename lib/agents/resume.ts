import { fireRoutine } from "@/lib/agents/claude-code";
import { type ClaudeCodeConfig, decryptConfig, type McpAgentConfig } from "@/lib/agents/config";
import { DispatchError } from "@/lib/agents/http";
import { failRun, recordRunActivity } from "@/lib/agents/lifecycle";
import { issueRepository } from "@/lib/agents/repo";
import { postAgentWebhook } from "@/lib/agents/webhook";
import { appUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { branchName } from "@/lib/github/branch";
import type { Ctx } from "@/lib/services/context";
import { formatKey } from "@/lib/services/issue-shapes";

/**
 * A person answered an agent that asked for input
 * (docs/features/16-github-sync-and-replies.md "Replies resume the agent").
 * Claude Code sessions end when they ask, so the routine is fired again with a
 * pointer to the reply; a generic MCP agent gets an issue.comment webhook.
 * Runs after the response, with the replier's Ctx for the history entry.
 */
export async function resumeRun(ctx: Ctx, runId: string, commentId: string) {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      agentId: true,
      issueId: true,
      agent: { select: { kind: true, enabled: true, configEnc: true } },
      issue: { select: { number: true, title: true, project: { select: { key: true, workspace: { select: { slug: true } } } } } },
    },
  });
  if (!run || run.status !== "NEEDS_INPUT" || !run.agent.enabled) return;

  const key = formatKey(run.issue.project.key, run.issue.number);
  const workspace = run.issue.project.workspace.slug;
  try {
    const repository = await issueRepository(run.issueId);
    if (run.agent.kind === "CLAUDE_CODE") {
      if (!repository) throw new DispatchError("The project has no connected GitHub repository");
      const config = decryptConfig<ClaudeCodeConfig>(run.agent.configEnc);
      const session = await fireRoutine(
        config,
        [
          `Kanso issue ${key} in workspace "${workspace}". Repository: ${repository.fullName}`,
          `Resuming: a teammate replied to your question on the issue. Branch: ${branchName(key, run.issue.title)}`,
        ].join("\n"),
      );
      await transition(ctx, run, commentId, {
        status: "DISPATCHED",
        dispatchedAt: new Date(),
        externalSessionId: session.sessionId,
        sessionUrl: session.sessionUrl,
      });
    } else {
      const config = decryptConfig<McpAgentConfig>(run.agent.configEnc);
      await postAgentWebhook(config, {
        event: "issue.comment",
        workspace,
        issue: { key, title: run.issue.title, url: `${appUrl()}/${workspace}/issues/${key}` },
        repository,
        run: { id: run.id },
        comment: { id: commentId },
      });
      await transition(ctx, run, commentId, { status: "RUNNING" });
    }
  } catch (error) {
    if (!(error instanceof DispatchError)) console.error("[agents.resume]", run.id, error instanceof Error ? error.name : "error");
    // A Claude Code run has no live session to pick the reply up, so free the issue for Retry.
    if (run.agent.kind === "CLAUDE_CODE") {
      await failRun(run.id, error instanceof DispatchError ? error.message : "Couldn't resume the agent", ["NEEDS_INPUT"]);
    }
  }
}

async function transition(
  ctx: Ctx,
  run: { id: string; agentId: string; issueId: string },
  commentId: string,
  data: { status: "DISPATCHED" | "RUNNING"; dispatchedAt?: Date; externalSessionId?: string | null; sessionUrl?: string | null },
) {
  await db.$transaction(async (tx) => {
    const { count } = await tx.agentRun.updateMany({ where: { id: run.id, status: "NEEDS_INPUT" }, data });
    if (count) await recordRunActivity(tx, ctx, run, "agent.resumed", { commentId });
  });
}
