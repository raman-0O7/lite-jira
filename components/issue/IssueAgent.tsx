"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, GitPullRequest, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { AgentIcon } from "@/components/icons/AgentIcon";
import { RunStatusBadge } from "@/components/issue/AgentBadges";
import { ago } from "@/components/issue/IssueActivity";
import { useCan } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { ACTIVE_RUN_STATUSES, agentKeys, fetchAgentRuns, retryAgentRun, RUN_STATUS_LABEL } from "@/lib/api/agents";
import { type IssueFull, issueKeys } from "@/lib/api/issues";
import { projectKeys } from "@/lib/api/projects";

const LINK = "flex items-center gap-2 rounded-md px-1 py-1 text-sm text-foreground hover:bg-accent";

/**
 * The Agent block in the issue sidebar: the assigned agent's latest run
 * (status, session, PR, error), Retry, and the run history.
 */
export function IssueAgent({ issue, projectId }: { issue: IssueFull; projectId: string }) {
  const queryClient = useQueryClient();
  const canDispatch = useCan("agent.dispatch");
  const hasAgentHistory = Boolean(issue.assigneeAgent || issue.agentRuns?.length);

  const runsQuery = useQuery({
    queryKey: agentKeys.runs(issue.id),
    queryFn: () => fetchAgentRuns(issue.id),
    enabled: hasAgentHistory,
    // Poll while a run is live, so the status follows the agent.
    refetchInterval: (query) =>
      query.state.data?.some((run) => ACTIVE_RUN_STATUSES.includes(run.status)) ? 10_000 : false,
  });

  const retry = useMutation({
    mutationFn: () => retryAgentRun(issue.id),
    onSuccess: () => {
      toast.success("New run started.");
      queryClient.invalidateQueries({ queryKey: agentKeys.runs(issue.id) });
      queryClient.invalidateQueries({ queryKey: issueKeys.detail(issue.id) });
      queryClient.invalidateQueries({ queryKey: issueKeys.activity(issue.id) });
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!hasAgentHistory) return null;
  const runs = runsQuery.data ?? [];
  const latest = runs[0] ?? issue.agentRuns?.[0];
  const ended = !latest || latest.status === "FAILED" || latest.status === "CANCELLED";

  return (
    <div className="mt-3 flex flex-col gap-1.5 border-t px-1 pt-3" aria-label="Agent">
      <span className="px-1 text-xs text-muted-foreground">Agent</span>
      {issue.assigneeAgent ? (
        <div className="flex items-center gap-2 px-1 py-1">
          <AgentIcon kind={issue.assigneeAgent.kind} className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm">{issue.assigneeAgent.name}</span>
          {latest ? <RunStatusBadge status={latest.status} kind={issue.assigneeAgent.kind} /> : null}
        </div>
      ) : null}
      {latest?.sessionUrl ? (
        <a href={latest.sessionUrl} target="_blank" rel="noreferrer" className={LINK}>
          <Play className="size-3.5 shrink-0 text-icon" />
          <span className="truncate">Watch session</span>
          <ExternalLink className="ml-auto size-3 shrink-0 text-muted-foreground" />
        </a>
      ) : null}
      {latest?.prUrl ? (
        <a href={latest.prUrl} target="_blank" rel="noreferrer" className={LINK}>
          <GitPullRequest className="size-3.5 shrink-0 text-icon" />
          <span className="truncate">Pull request</span>
          <ExternalLink className="ml-auto size-3 shrink-0 text-muted-foreground" />
        </a>
      ) : null}
      {latest?.error && latest.status === "FAILED" ? (
        <p className="rounded-md bg-danger/10 px-2 py-1.5 text-xs break-words text-danger">{latest.error}</p>
      ) : null}
      {canDispatch && issue.assigneeAgent && ended ? (
        <Button
          variant="outline"
          size="sm"
          className="justify-start"
          loading={retry.isPending}
          onClick={() => retry.mutate()}
        >
          <RotateCcw />
          Retry
        </Button>
      ) : null}
      {runs.length > 1 ? (
        <details className="px-1 text-xs text-muted-foreground">
          <summary className="cursor-pointer py-1 select-none hover:text-foreground">Earlier runs</summary>
          <ul className="flex flex-col gap-1 pt-1">
            {runs.slice(1).map((run) => (
              <li key={run.id} className="flex items-center gap-2" title={run.error ?? undefined}>
                <span className="min-w-0 flex-1 truncate">
                  {run.agent.name} · {RUN_STATUS_LABEL[run.status]}
                </span>
                <span className="shrink-0">{ago(run.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
