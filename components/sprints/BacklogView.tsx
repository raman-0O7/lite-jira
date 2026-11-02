"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, MoreHorizontal, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { PriorityIcon } from "@/components/icons/PriorityIcon";
import { StatusIcon } from "@/components/icons/StatusIcon";
import { AssigneeAvatars } from "@/components/issue/AgentBadges";
import { BlockedChip } from "@/components/issue/BlockedChip";
import { IssueRowsSkeleton } from "@/components/loading/skeletons";
import { useCan } from "@/components/providers/workspace-provider";
import {
  CompleteSprintDialog,
  EditSprintDialog,
  MoveToSprintMenu,
  sprintDates,
  StartSprintDialog,
  useRefreshSprints,
} from "@/components/sprints/sprint-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type BacklogIssue,
  createSprint,
  deleteSprint,
  fetchBacklog,
  type Sprint,
  sprintKeys,
} from "@/lib/api/sprints";
import { variantForCategory } from "@/lib/status";
import { cn } from "@/lib/utils";

type Section = {
  id: string;
  sprint: (Sprint & { issues: BacklogIssue[] }) | null;
  issues: BacklogIssue[];
};

function totalsOf(issues: BacklogIssue[]) {
  const points = issues.reduce((n, i) => n + (i.estimate ?? 0), 0);
  const done = issues.filter((i) => i.column.category === "DONE");
  return { count: issues.length, done: done.length, points, donePoints: done.reduce((n, i) => n + (i.estimate ?? 0), 0) };
}

/**
 * Scrum backlog (docs/features/21-sprints.md §3): the active sprint, planned
 * sprints, then open issues in no sprint.
 */
export function BacklogView({
  projectId,
  onOpenIssue,
  onNewIssue,
}: {
  projectId: string;
  onOpenIssue: (key: string) => void;
  onNewIssue: (sprintId: string | null) => void;
}) {
  const canPlan = useCan("sprint.manage");
  const canEdit = useCan("issue.write");
  const backlog = useQuery({ queryKey: sprintKeys.backlog(projectId), queryFn: () => fetchBacklog(projectId) });
  const refresh = useRefreshSprints(projectId);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState<(Sprint & { issueCount: number }) | null>(null);
  const [completing, setCompleting] = useState<Sprint | null>(null);
  const [editing, setEditing] = useState<Sprint | null>(null);
  const [deleting, setDeleting] = useState<Sprint | null>(null);

  const create = useMutation({
    mutationFn: () => createSprint(projectId),
    onSuccess: (sprint) => {
      refresh();
      toast.success(`${sprint.name} created`);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const remove = useMutation({
    mutationFn: (sprint: Sprint) => deleteSprint(sprint.id),
    onSuccess: () => {
      refresh();
      setDeleting(null);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (backlog.isPending) return <IssueRowsSkeleton label="Loading the backlog" />;
  if (backlog.isError) return <p className="p-6 text-sm text-destructive">{backlog.error.message}</p>;

  const hasActive = backlog.data.sprints.some((s) => s.state === "ACTIVE");
  const sections: Section[] = [
    ...backlog.data.sprints.map((sprint) => ({ id: sprint.id, sprint, issues: sprint.issues })),
    { id: "backlog", sprint: null, issues: backlog.data.backlog },
  ];

  function toggle(id: string) {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  }

  return (
    <div className="h-full overflow-y-auto pb-10">
      {sections.map((section) => {
        const { sprint } = section;
        const isCollapsed = collapsed.has(section.id);
        const t = totalsOf(section.issues);
        const dates = sprint ? sprintDates(sprint) : null;
        return (
          <section key={section.id} aria-label={sprint?.name ?? "Backlog"} className="border-b">
            <div className="sticky top-0 z-10 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 border-b bg-[color-mix(in_srgb,var(--background)_92%,var(--foreground))] px-4 py-1.5 md:px-5">
              <button
                type="button"
                onClick={() => toggle(section.id)}
                aria-expanded={!isCollapsed}
                className="flex min-w-0 items-center gap-2 text-left"
              >
                <ChevronRight className={cn("size-3.5 shrink-0 text-icon transition-transform", !isCollapsed && "rotate-90")} />
                <h2 className="truncate text-sm font-semibold text-foreground">{sprint?.name ?? "Backlog"}</h2>
                {sprint?.state === "ACTIVE" ? (
                  <span className="rounded bg-primary-soft px-1.5 py-px text-2xs font-medium text-primary-text">Active</span>
                ) : null}
              </button>
              <span className="text-xs text-muted-foreground tabular">
                {sprint?.state === "ACTIVE" ? `${t.done}/${t.count}` : t.count} {t.count === 1 ? "issue" : "issues"}
                {t.points > 0 ? ` · ${sprint?.state === "ACTIVE" ? `${t.donePoints}/` : ""}${t.points} pts` : ""}
              </span>
              {dates ? <span className="text-xs text-muted-foreground">{dates}</span> : null}
              {sprint?.goal ? (
                <span className="hidden min-w-0 flex-1 truncate text-xs text-soft md:inline" title={sprint.goal}>
                  {sprint.goal}
                </span>
              ) : (
                <span className="flex-1" />
              )}
              <div className="ml-auto flex items-center gap-1">
                {sprint && canPlan && sprint.state === "ACTIVE" ? (
                  <Button size="xs" variant="outline" onClick={() => setCompleting(sprint)}>
                    Complete sprint
                  </Button>
                ) : null}
                {sprint && canPlan && sprint.state === "PLANNED" && !hasActive ? (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={section.issues.length === 0}
                    title={section.issues.length === 0 ? "Add issues before starting" : undefined}
                    onClick={() => setStarting({ ...sprint, issueCount: section.issues.length })}
                  >
                    <Play /> Start sprint
                  </Button>
                ) : null}
                {!sprint && canPlan ? (
                  <Button size="xs" variant="outline" loading={create.isPending} onClick={() => create.mutate()}>
                    <Plus /> Create sprint
                  </Button>
                ) : null}
                {canEdit ? (
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    aria-label={`New issue in ${sprint?.name ?? "the backlog"}`}
                    title="New issue"
                    onClick={() => onNewIssue(sprint?.id ?? null)}
                  >
                    <Plus />
                  </Button>
                ) : null}
                {sprint && canPlan ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-xs" variant="ghost" aria-label={`${sprint.name} options`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setEditing(sprint)}>
                        <Pencil /> Edit sprint
                      </DropdownMenuItem>
                      {sprint.state === "PLANNED" ? (
                        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(sprint)}>
                          <Trash2 /> Delete sprint
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </div>
            </div>
            {isCollapsed ? null : section.issues.length === 0 ? (
              <p className="px-4 py-3 text-xs text-muted-foreground md:px-5">
                {sprint
                  ? "No issues yet. Use Move to on a backlog issue, or add one here."
                  : "The backlog is empty. Open issues that aren’t in a sprint show up here."}
              </p>
            ) : (
              <ul>
                {section.issues.map((issue) => (
                  <BacklogRow
                    key={issue.id}
                    issue={issue}
                    projectId={projectId}
                    canEdit={canEdit}
                    onOpen={() => onOpenIssue(issue.key)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <StartSprintDialog projectId={projectId} sprint={starting} onOpenChange={(open) => !open && setStarting(null)} />
      <CompleteSprintDialog projectId={projectId} sprint={completing} onOpenChange={(open) => !open && setCompleting(null)} />
      <EditSprintDialog projectId={projectId} sprint={editing} onOpenChange={(open) => !open && setEditing(null)} />
      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleting?.name}?</DialogTitle>
            <DialogDescription>Its issues go back to the backlog.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="destructive" loading={remove.isPending} onClick={() => deleting && remove.mutate(deleting)}>
              Delete sprint
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BacklogRow({
  issue,
  projectId,
  canEdit,
  onOpen,
}: {
  issue: BacklogIssue;
  projectId: string;
  canEdit: boolean;
  onOpen: () => void;
}) {
  const done = issue.column.category === "DONE";
  return (
    <li className="group flex h-9 items-center border-b last:border-b-0 hover:bg-accent/60">
      <button
        type="button"
        onClick={onOpen}
        className="flex h-full min-w-0 flex-1 items-center gap-3 pl-4 text-left text-sm outline-none focus-visible:bg-accent md:pl-5"
      >
        <PriorityIcon priority={issue.priority} />
        <span className="w-[68px] shrink-0 truncate font-mono text-2xs text-muted-foreground">{issue.key}</span>
        <StatusIcon variant={variantForCategory(issue.column.category)} label={issue.column.name} />
        <IssueTypeIcon type={issue.type} />
        <span className={cn("min-w-0 flex-1 truncate font-medium", done ? "text-muted-foreground line-through" : "text-foreground")}>
          {issue.title}
        </span>
        <BlockedChip blockedBy={issue.blockedBy} />
        {issue.subIssueCount > 0 ? (
          <span className="hidden text-2xs text-muted-foreground tabular sm:inline" title="Sub-issues done">
            {issue.subIssueDoneCount}/{issue.subIssueCount}
          </span>
        ) : null}
        <span
          className={cn(
            "flex h-5 min-w-6 items-center justify-center rounded-full bg-chip px-1.5 text-2xs font-medium tabular",
            issue.estimate === null ? "text-muted-foreground/60" : "text-soft",
          )}
          title={issue.estimate === null ? "No estimate" : `${issue.estimate} story points`}
        >
          {issue.estimate ?? "–"}
        </span>
        <span className="flex min-w-5 shrink-0 justify-end">
          <AssigneeAvatars person={issue.assignee} agent={issue.assigneeAgent} />
        </span>
      </button>
      {canEdit ? (
        <MoveToSprintMenu
          projectId={projectId}
          issueId={issue.id}
          currentSprintId={issue.sprintId ?? null}
          trigger={
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Move ${issue.key} to a sprint`}
              className="mr-2 ml-1 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <MoreHorizontal />
            </Button>
          }
        />
      ) : (
        <span className="w-3" />
      )}
    </li>
  );
}
