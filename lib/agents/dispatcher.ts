import { fireRoutine } from "@/lib/agents/claude-code";
import { type ClaudeCodeConfig, decryptConfig, type McpAgentConfig } from "@/lib/agents/config";
import { DispatchError } from "@/lib/agents/http";
import { failRun } from "@/lib/agents/lifecycle";
import { postAgentWebhook } from "@/lib/agents/webhook";
import { appUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { formatKey } from "@/lib/services/issue-shapes";

/**
 * Hand a QUEUED run to its agent's runtime (docs/features/12-agents.md
 * "Adapters"). Runs after the response. Never retries: a failure marks the run
 * FAILED with a message the user can act on, and they can Retry.
 */
export async function dispatchRun(runId: string) {
  const run = await db.agentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      agent: { select: { id: true, kind: true, enabled: true, configEnc: true } },
      issue: { select: { number: true, title: true, project: { select: { key: true, workspace: { select: { slug: true } } } } } },
    },
  });
  if (!run || run.status !== "QUEUED") return;
  if (!run.agent.enabled) {
    await failRun(run.id, "The agent is disabled", ["QUEUED"]);
    return;
  }

  const key = formatKey(run.issue.project.key, run.issue.number);
  const workspace = run.issue.project.workspace.slug;
  try {
    if (run.agent.kind === "CLAUDE_CODE") {
      const config = decryptConfig<ClaudeCodeConfig>(run.agent.configEnc);
      const session = await fireRoutine(config, `Kanso issue ${key} in workspace "${workspace}"`);
      await db.agentRun.updateMany({
        where: { id: run.id, status: "QUEUED" },
        data: {
          status: "DISPATCHED",
          dispatchedAt: new Date(),
          externalSessionId: session.sessionId,
          sessionUrl: session.sessionUrl,
        },
      });
    } else {
      const config = decryptConfig<McpAgentConfig>(run.agent.configEnc);
      await postAgentWebhook(config, {
        event: "issue.assigned",
        workspace,
        issue: { key, title: run.issue.title, url: `${appUrl()}/${workspace}/issues/${key}` },
        run: { id: run.id },
      });
      await db.agentRun.updateMany({
        where: { id: run.id, status: "QUEUED" },
        data: { status: "DISPATCHED", dispatchedAt: new Date() },
      });
    }
  } catch (error) {
    if (!(error instanceof DispatchError)) console.error("[agents.dispatch]", run.id, error instanceof Error ? error.name : "error");
    await failRun(run.id, error instanceof DispatchError ? error.message : "Dispatch failed", ["QUEUED"]);
  }
}
