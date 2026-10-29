import { type McpAgentConfig, decryptConfig } from "@/lib/agents/config";
import { DispatchError } from "@/lib/agents/http";
import { recordRunActivity } from "@/lib/agents/lifecycle";
import { issueRepository } from "@/lib/agents/repo";
import { postAgentWebhook } from "@/lib/agents/webhook";
import { appUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/services/context";
import { formatKey } from "@/lib/services/issue-shapes";

/**
 * A person answered an MCP agent that asked for input
 * (docs/features/16-github-sync-and-replies.md "Answering an agent"): send it a
 * signed issue.comment webhook and set the run back to RUNNING. Claude Code
 * isn't resumed from here: its session waits, idle, for an answer in the
 * session itself. Runs after the response, with the replier's Ctx.
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
  if (!run || run.status !== "NEEDS_INPUT" || run.agent.kind !== "MCP" || !run.agent.enabled) return;

  const key = formatKey(run.issue.project.key, run.issue.number);
  const workspace = run.issue.project.workspace.slug;
  try {
    const config = decryptConfig<McpAgentConfig>(run.agent.configEnc);
    await postAgentWebhook(config, {
      event: "issue.comment",
      workspace,
      issue: { key, title: run.issue.title, url: `${appUrl()}/${workspace}/issues/${key}` },
      repository: await issueRepository(run.issueId),
      run: { id: run.id },
      comment: { id: commentId },
    });
  } catch (error) {
    // The agent may still see the reply when it next reads the issue.
    if (!(error instanceof DispatchError)) console.error("[agents.resume]", run.id, error instanceof Error ? error.name : "error");
    return;
  }
  await db.$transaction(async (tx) => {
    const { count } = await tx.agentRun.updateMany({ where: { id: run.id, status: "NEEDS_INPUT" }, data: { status: "RUNNING" } });
    if (count) await recordRunActivity(tx, ctx, run, "agent.resumed", { commentId });
  });
}
