import { newClaimCode } from "@/lib/agents/claim-code";
import { reconcileActiveRuns, startWorkspaceSession } from "@/lib/agents/claude-api";
import { fireRoutine } from "@/lib/agents/claude-code";
import { type ClaudeApiConfig, type ClaudeCodeConfig, decryptConfig, type McpAgentConfig } from "@/lib/agents/config";
import { DispatchError } from "@/lib/agents/http";
import { interruptRunSessions } from "@/lib/agents/claude-api-client";
import { failRun } from "@/lib/agents/lifecycle";
import { issueRepository } from "@/lib/agents/repo";
import { postAgentWebhook } from "@/lib/agents/webhook";
import { appUrl } from "@/lib/app-url";
import { db } from "@/lib/db";
import { GitHubError, tokenRepo } from "@/lib/github/client";
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
      agent: { select: { id: true, name: true, kind: true, enabled: true, configEnc: true } },
      issue: { select: { id: true, number: true, title: true, project: { select: { key: true, workspace: { select: { slug: true } } } } } },
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
    const repository = await issueRepository(run.issue.id);
    if (run.agent.kind === "CLAUDE_CODE") {
      // Checked at assign time too; the repo may have been disconnected since.
      if (!repository) throw new DispatchError("The project has no connected GitHub repository");
      const config = decryptConfig<ClaudeCodeConfig>(run.agent.configEnc);
      // Stored before firing so a fast session can't claim ahead of it.
      const claim = newClaimCode();
      await db.agentRun.updateMany({ where: { id: run.id, status: "QUEUED" }, data: { claimCodeHash: claim.hash } });
      const session = await fireRoutine(
        config,
        `Kanso issue ${key} in workspace "${workspace}". Repository: ${repository.fullName}.${repository.baseBranch ? ` Base branch: ${repository.baseBranch}.` : ""} Claim code: ${claim.code}`,
      );
      await db.agentRun.updateMany({
        where: { id: run.id, status: "QUEUED" },
        data: {
          status: "DISPATCHED",
          dispatchedAt: new Date(),
          externalSessionId: session.sessionId,
          sessionUrl: session.sessionUrl,
        },
      });
    } else if (run.agent.kind === "CLAUDE_API") {
      if (!repository) throw new DispatchError("The project has no connected GitHub repository");
      await assertCanPush(decryptConfig<ClaudeApiConfig>(run.agent.configEnc).githubToken, repository.fullName);
      // Up-to-date costs for the monthly limit.
      await reconcileActiveRuns({ agentId: run.agent.id });
      const session = await startWorkspaceSession({
        agentId: run.agent.id,
        agentName: run.agent.name,
        configEnc: run.agent.configEnc,
        runId: run.id,
        key,
        title: run.issue.title,
        workspace,
        repository,
      });
      const { count } = await db.agentRun.updateMany({
        where: { id: run.id, status: "QUEUED" },
        data: {
          status: "DISPATCHED",
          dispatchedAt: new Date(),
          externalSessionId: session.sessionId,
          sessionUrl: session.sessionUrl,
          budgetCents: session.budgetCents,
          syncedAt: new Date(),
        },
      });
      if (!count) {
        // Cancelled while the session was starting: stop it.
        await db.agentRun.update({ where: { id: run.id }, data: { externalSessionId: session.sessionId } });
        await interruptRunSessions([run.id]);
      }
    } else {
      const config = decryptConfig<McpAgentConfig>(run.agent.configEnc);
      await postAgentWebhook(config, {
        event: "issue.assigned",
        workspace,
        issue: { key, title: run.issue.title, url: `${appUrl()}/${workspace}/issues/${key}` },
        repository,
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

/** The workspace agent's GitHub token must be able to push to the repository. */
async function assertCanPush(token: string, repo: string) {
  try {
    const access = await tokenRepo(token, repo);
    if (!access.permissions?.push) throw new DispatchError(`The workspace agent's GitHub token can't push to ${repo}`);
  } catch (error) {
    if (!(error instanceof GitHubError)) throw error;
    throw new DispatchError(
      error.status === 401
        ? "GitHub rejected the workspace agent's token. An admin can replace it in Settings → Agents."
        : error.status === 404
          ? `The workspace agent's GitHub token can't see ${repo}`
          : "Couldn't check the workspace agent's access on GitHub",
    );
  }
}
