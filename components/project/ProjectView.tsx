"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChartLine, ChevronRight, Columns3, IterationCcw, List, ListTodo, MoreHorizontal, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader, PageTitle } from "@/components/app-shell/PageHeader";
import { ProjectRepos } from "@/components/project/ProjectRepos";
import { useAppUI, useRegisterNewIssue } from "@/components/app-shell/app-ui";
import { AvatarStack } from "@/components/icons/Avatar";
import { Kbd } from "@/components/icons/Kbd";
import { ProjectTile } from "@/components/icons/ProjectTile";
import { IssuePanel } from "@/components/issue/IssuePanel";
import { NewIssueDialog } from "@/components/issue/NewIssueDialog";
import { ProjectSkeleton } from "@/components/loading/skeletons";
import { KanbanBoard } from "@/components/project/board/KanbanBoard";
import { type AssigneeOption, FilterBar } from "@/components/project/filters/FilterBar";
import { IssueList } from "@/components/project/list/IssueList";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { BacklogView } from "@/components/sprints/BacklogView";
import { SprintReports } from "@/components/sprints/SprintReports";
import { CompleteSprintDialog, sprintDates, useRefreshSprints } from "@/components/sprints/sprint-ui";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBoardFilters } from "@/hooks/use-board-filters";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { deleteIssue } from "@/lib/api/issues";
import {
  createColumn,
  deleteColumn,
  fetchProject,
  projectKeys,
  renameColumn,
  reorderColumns,
  updateColumn,
  type ColumnCategory,
  type ColumnWithIssues,
  type IssueCard,
  type AgentStub,
  type LabelStub,
  type PersonStub,
  type ProjectDetail,
} from "@/lib/api/projects";
import { setProjectMode } from "@/lib/api/sprints";
import { isFiltersEmpty, matchesFilters } from "@/lib/board-filters";
import { statusVariants } from "@/lib/status";
import { cn } from "@/lib/utils";

type View = "board" | "list" | "backlog" | "reports";
const SCRUM_VIEWS: View[] = ["backlog", "reports"];

/** The labels in use on the project's issues (deduped, by name): the label filter's options. */
function deriveLabels(columns: ColumnWithIssues[]): LabelStub[] {
  const seen = new Map<string, LabelStub>();
  for (const column of columns) {
    for (const issue of column.issues) {
      for (const label of issue.labels) seen.set(label.id, label);
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The people issues are assigned to, most issues first. */
function deriveAssignees(columns: ColumnWithIssues[]): PersonStub[] {
  const counts = new Map<string, { person: PersonStub; count: number }>();
  for (const column of columns) {
    for (const issue of column.issues) {
      if (!issue.assignee) continue;
      const entry = counts.get(issue.assignee.id);
      if (entry) entry.count++;
      else counts.set(issue.assignee.id, { person: issue.assignee, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).map((e) => e.person);
}

/** Assignee filter options: people (most issues first), then agents. */
function deriveAssigneeOptions(columns: ColumnWithIssues[], people: PersonStub[]): AssigneeOption[] {
  const agents = new Map<string, AgentStub>();
  for (const column of columns) {
    for (const issue of column.issues) {
      if (issue.assigneeAgent) agents.set(issue.assigneeAgent.id, issue.assigneeAgent);
    }
  }
  return [
    ...people.map((person) => ({ token: `user:${person.id}`, name: person.name, person })),
    ...[...agents.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((agent) => ({ token: `agent:${agent.id}`, name: agent.name, agent })),
  ];
}

/**
 * Set or clear one query param without a navigation. Next keeps
 * `useSearchParams` in sync with `history.replaceState`.
 */
function replaceParam(pathname: string, name: string, value: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(name, value);
  else params.delete(name);
  const query = params.toString();
  window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
}

/**
 * A project page: toolbar, filter row, the board or list view (`?view=list`),
 * the issue panel (`?issue=KEY`), and the new-issue dialog.
 */
export function ProjectView({ projectId }: { projectId: string }) {
  const { slug } = useWorkspace();
  const canEditIssues = useCan("issue.write");
  const canUpdateProject = useCan("project.update");
  const canPlan = useCan("sprint.manage");
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useBoardFilters();
  const searchRef = useRef<HTMLInputElement>(null);

  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [newIssue, setNewIssue] = useState<{ open: boolean; columnId: string | null; sprintId: string | null }>({
    open: false,
    columnId: null,
    sprintId: null,
  });
  const [completing, setCompleting] = useState<{ id: string; name: string } | null>(null);

  const viewParam = searchParams.get("view");
  const requestedView: View =
    viewParam === "list" || viewParam === "backlog" || viewParam === "reports" ? viewParam : "board";
  const issueParam = searchParams.get("issue")?.toUpperCase() ?? null;

  const projectQuery = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => fetchProject(projectId),
  });

  function patchColumns(updater: (columns: ColumnWithIssues[]) => ColumnWithIssues[]) {
    queryClient.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (prev) =>
      prev ? { ...prev, columns: updater(prev.columns) } : prev,
    );
  }

  function snapshotColumns() {
    return queryClient.getQueryData<ProjectDetail>(projectKeys.detail(projectId))?.columns ?? [];
  }

  const addColumn = useMutation({
    mutationFn: (name: string) => createColumn(projectId, name),
    onSuccess: (column) => {
      patchColumns((columns) => [...columns, column]);
      setAddColumnOpen(false);
      setNewColumnName("");
      toast.success("Column added.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameColumn(id, name),
    onSuccess: (updated) => {
      patchColumns((columns) => columns.map((c) => (c.id === updated.id ? { ...c, name: updated.name } : c)));
      toast.success("Column renamed.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const recategorize = useMutation({
    mutationFn: ({ id, category }: { id: string; category: ColumnCategory }) => updateColumn(id, { category }),
    onMutate: ({ id, category }) => {
      const previous = snapshotColumns();
      patchColumns((columns) => columns.map((c) => (c.id === id ? { ...c, category } : c)));
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) patchColumns(() => context.previous);
      toast.error(error.message);
    },
  });

  const removeColumn = useMutation({
    mutationFn: (id: string) => deleteColumn(id),
    onSuccess: (_data, id) => {
      patchColumns((columns) => columns.filter((c) => c.id !== id));
      toast.success("Column deleted.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  // Optimistic: the new order shows at once and rolls back if the save fails.
  const reorder = useMutation({
    mutationFn: ({ orderedIds }: { orderedIds: string[]; ordered: ColumnWithIssues[] }) =>
      reorderColumns(projectId, orderedIds),
    onMutate: ({ ordered }) => {
      const previous = snapshotColumns();
      patchColumns(() => ordered);
      return { previous };
    },
    onError: (error: Error, _vars, context) => {
      if (context?.previous) patchColumns(() => context.previous);
      toast.error(error.message);
    },
  });

  const removeIssue = useMutation({
    mutationFn: (issueId: string) => deleteIssue(issueId),
    onMutate: (issueId) => {
      const previous = snapshotColumns();
      patchColumns((columns) =>
        columns.map((c) => ({
          ...c,
          issues: c.issues.filter((i) => i.id !== issueId).map((i, index) => ({ ...i, position: index })),
        })),
      );
      return { previous };
    },
    onSuccess: () => toast.success("Issue deleted."),
    onError: (error: Error, _issueId, context) => {
      if (context?.previous) patchColumns(() => context.previous);
      toast.error(error.message);
    },
  });

  const refreshSprints = useRefreshSprints(projectId);
  const switchMode = useMutation({
    mutationFn: (mode: "KANBAN" | "SCRUM") => setProjectMode(projectId, mode),
    onSuccess: (updated) => {
      refreshSprints();
      queryClient.invalidateQueries({ queryKey: projectKeys.lists(slug) });
      replaceParam(pathname, "view", updated.mode === "SCRUM" ? "backlog" : null);
      toast.success(updated.mode === "SCRUM" ? "Sprints are on. Plan the first one in the backlog." : "Sprints are off.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const project = projectQuery.data;
  const scrum = project?.mode === "SCRUM";
  const view: View = !scrum && SCRUM_VIEWS.includes(requestedView) ? "board" : requestedView;
  const activeSprint = scrum ? (project?.activeSprint ?? null) : null;
  // Scrum boards show the active sprint (display only; moves still see whole columns).
  const include = scrum ? (issue: IssueCard) => issue.sprintId === activeSprint?.id : undefined;
  const columns = project?.columns ?? [];
  const scopedColumns = include ? columns.map((c) => ({ ...c, issues: c.issues.filter(include) })) : columns;
  const allIssues = columns.flatMap((c) => c.issues);
  const openIssue = issueParam ? (allIssues.find((i) => i.key === issueParam) ?? null) : null;

  function openIssueByKey(key: string | null) {
    replaceParam(pathname, "issue", key);
  }

  function openIssueById(issueId: string) {
    const issue = allIssues.find((i) => i.id === issueId);
    if (issue) openIssueByKey(issue.key);
  }

  function setView(next: View) {
    replaceParam(pathname, "view", next === "board" ? null : next);
  }

  function startNewIssue(columnId: string | null = null, sprintId: string | null = activeSprint?.id ?? null) {
    setNewIssue({ open: true, columnId, sprintId });
  }

  useRegisterNewIssue(project && canEditIssues && columns.length > 0 ? () => startNewIssue() : null);

  const { setShortcutsOpen } = useAppUI();
  const overlayOpen = newIssue.open || addColumnOpen || openIssue !== null;
  useHotkeys(
    {
      "/": () => searchRef.current?.focus(),
      "g b": () => {
        setShortcutsOpen(false);
        setView("board");
      },
      "g l": () => {
        setShortcutsOpen(false);
        setView("list");
      },
    },
    !overlayOpen,
  );

  if (projectQuery.isPending) {
    return <ProjectSkeleton view={view === "list" ? "list" : "board"} />;
  }

  if (projectQuery.isError || !project) {
    const message = (projectQuery.error as Error | null)?.message ?? "Failed to load project";
    const notFound = message.toLowerCase().includes("not found");
    return (
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-sm text-muted-foreground">{notFound ? "This project doesn’t exist." : message}</p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/${slug}/projects`}>
            <ArrowLeft />
            Back to projects
          </Link>
        </Button>
      </div>
    );
  }

  const filtersActive = !isFiltersEmpty(filters.filters);
  function visibleIssues(column: ColumnWithIssues): IssueCard[] {
    const scoped = include ? column.issues.filter(include) : column.issues;
    if (!filtersActive) return scoped;
    return scoped.filter((issue) => matchesFilters(issue, filters.filters));
  }
  const variants = statusVariants(columns);
  const doneColumnIds = new Set(columns.filter((c) => c.category === "DONE").map((c) => c.id));
  const scopedIssues = scopedColumns.flatMap((c) => c.issues);
  const progress = {
    total: scopedIssues.length,
    done: scopedIssues.filter((i) => doneColumnIds.has(i.columnId)).length,
  };
  const assignees = deriveAssignees(scopedColumns);
  const boardLike = view === "board" || view === "list";
  const tabs = (
    scrum
      ? [
          { id: "backlog", label: "Backlog", icon: ListTodo },
          { id: "board", label: "Board", icon: Columns3 },
          { id: "list", label: "List", icon: List },
          { id: "reports", label: "Reports", icon: ChartLine },
        ]
      : [
          { id: "board", label: "Board", icon: Columns3 },
          { id: "list", label: "List", icon: List },
        ]
  ) satisfies { id: View; label: string; icon: typeof List }[];

  function handleAddColumn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = newColumnName.trim();
    if (!trimmed) {
      toast.error("Name is required.");
      return;
    }
    addColumn.mutate(trimmed);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        actions={
          <>
            {assignees.length > 0 ? (
              <span className="mr-1 hidden sm:flex" title={assignees.map((p) => p.name).join(", ")}>
                <AvatarStack people={assignees} max={4} />
              </span>
            ) : null}
            <ProjectRepos project={project} />
            <ThemeToggle />
            {canUpdateProject ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Project options">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem
                    disabled={switchMode.isPending}
                    onSelect={() => switchMode.mutate(scrum ? "KANBAN" : "SCRUM")}
                  >
                    <IterationCcw />
                    {scrum ? "Stop using sprints" : "Use sprints (Scrum)"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canEditIssues && columns.length > 0 ? (
              <Button size="sm" onClick={() => startNewIssue()} className="gap-1.5">
                <Plus />
                <span className="hidden sm:inline">New issue</span>
                <Kbd className="hidden border-white/20 bg-white/15 text-primary-foreground sm:inline-flex">C</Kbd>
              </Button>
            ) : null}
          </>
        }
      >
        <Link
          href={`/${slug}/projects`}
          className="hidden min-w-0 items-center gap-2 rounded-md text-soft hover:text-foreground sm:flex"
        >
          <ProjectTile projectKey={project.key} name={project.name} size="md" />
          <span className="truncate text-sm font-medium">{project.name}</span>
        </Link>
        <ProjectTile projectKey={project.key} name={project.name} size="md" className="sm:hidden" />
        <ChevronRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" aria-hidden="true" />
        <PageTitle className="sr-only sm:not-sr-only">{tabs.find((t) => t.id === view)?.label ?? "Board"}</PageTitle>
        <div
          role="tablist"
          aria-label="View"
          className="ml-1 flex h-7 shrink-0 items-center rounded-md bg-chip p-0.5"
        >
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                view === id && "bg-seg text-foreground shadow-seg",
              )}
            >
              <Icon className="size-3.5" />
              <span className={cn(scrum && "hidden sm:inline")}>{label}</span>
            </button>
          ))}
        </div>
      </PageHeader>

      {scrum && boardLike && activeSprint ? (
        <SprintStrip
          sprint={activeSprint}
          done={progress.done}
          total={progress.total}
          onComplete={canPlan ? () => setCompleting(activeSprint) : undefined}
        />
      ) : null}

      {boardLike && (!scrum || activeSprint) ? (
        <FilterBar
          labels={deriveLabels(scopedColumns)}
          assignees={deriveAssigneeOptions(scopedColumns, assignees)}
          filters={filters}
          progress={progress}
          searchRef={searchRef}
        />
      ) : null}

      <div className="min-h-0 flex-1">
        {view === "backlog" ? (
          <BacklogView
            projectId={projectId}
            onOpenIssue={(key) => openIssueByKey(key)}
            onNewIssue={(sprintId) => startNewIssue(null, sprintId)}
          />
        ) : view === "reports" ? (
          <SprintReports projectId={projectId} />
        ) : scrum && !activeSprint ? (
          <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-3 p-8 text-center">
            <IterationCcw className="size-6 text-icon" />
            <h2 className="font-heading text-base font-semibold text-foreground">No active sprint</h2>
            <p className="text-sm text-muted-foreground">
              The board shows the active sprint’s issues. Plan a sprint in the backlog and start it.
            </p>
            <Button size="sm" variant="outline" onClick={() => setView("backlog")}>
              Go to the backlog
            </Button>
          </div>
        ) : view === "board" ? (
          <div className="h-full overflow-x-auto overflow-y-hidden px-4 pt-3 md:px-5">
            <KanbanBoard
              projectId={projectId}
              columns={columns}
              columnsBusy={rename.isPending || removeColumn.isPending}
              filters={filters.filters}
              include={include}
              sprintId={activeSprint?.id ?? null}
              onAddColumn={() => setAddColumnOpen(true)}
              onRenameColumn={(id, name) => rename.mutate({ id, name })}
              onDeleteColumn={(id) => removeColumn.mutate(id)}
              onSetColumnCategory={(id, category) => recategorize.mutate({ id, category })}
              onReorderColumns={(orderedIds, ordered) => reorder.mutate({ orderedIds, ordered })}
              onOpenIssue={openIssueById}
              onDeleteIssue={(id) => removeIssue.mutate(id)}
              onAddIssue={(columnId) => startNewIssue(columnId)}
              deleting={removeIssue.isPending}
            />
          </div>
        ) : (
          <IssueList
            columns={columns}
            visible={visibleIssues}
            variants={variants}
            filtersActive={filtersActive}
            openIssueId={openIssue?.id ?? null}
            keyboardEnabled={!overlayOpen}
            onOpenIssue={openIssueById}
            onAddIssue={(columnId) => startNewIssue(columnId)}
          />
        )}
      </div>

      <IssuePanel
        projectId={projectId}
        issueId={openIssue?.id ?? null}
        onClose={() => openIssueByKey(null)}
        onNavigate={(key) => openIssueByKey(key)}
        onDeleted={(id) => {
          openIssueByKey(null);
          removeIssue.mutate(id);
        }}
      />

      <NewIssueDialog
        project={project}
        columnId={newIssue.columnId}
        sprintId={scrum ? newIssue.sprintId : null}
        open={newIssue.open}
        onOpenChange={(open) => setNewIssue((prev) => ({ ...prev, open }))}
        onCreated={(issue) => openIssueByKey(issue.key)}
      />

      <CompleteSprintDialog projectId={projectId} sprint={completing} onOpenChange={(open) => !open && setCompleting(null)} />

      <Dialog open={addColumnOpen} onOpenChange={setAddColumnOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add column</DialogTitle>
            <DialogDescription>
              Adds a column to the end of the board. Its menu sets whether it means to do, in progress, or done.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddColumn} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="new-column-name">Name</Label>
              <Input
                id="new-column-name"
                value={newColumnName}
                onChange={(event) => setNewColumnName(event.target.value)}
                placeholder="e.g. Review"
                disabled={addColumn.isPending}
                autoFocus
                maxLength={100}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddColumnOpen(false)}
                disabled={addColumn.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" loading={addColumn.isPending} loadingText="Adding…">
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Above a Scrum board: the active sprint, its dates and progress, and Complete. */
function SprintStrip({
  sprint,
  done,
  total,
  onComplete,
}: {
  sprint: NonNullable<ProjectDetail["activeSprint"]>;
  done: number;
  total: number;
  onComplete?: () => void;
}) {
  const dates = sprintDates({ ...sprint, state: "ACTIVE" });
  return (
    <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-1.5 text-xs md:px-5">
      <span className="flex items-center gap-1.5 font-semibold text-foreground">
        <IterationCcw className="size-3.5 text-icon" />
        {sprint.name}
      </span>
      {dates ? <span className="text-muted-foreground">{dates}</span> : null}
      <span className="flex items-center gap-1.5 text-muted-foreground tabular">
        <span className="h-1 w-16 overflow-hidden rounded-full bg-track">
          <span className="block h-1 rounded-full bg-success" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </span>
        {done}/{total} done
      </span>
      {sprint.goal ? (
        <span className="hidden min-w-0 flex-1 truncate text-soft md:inline" title={sprint.goal}>
          {sprint.goal}
        </span>
      ) : (
        <span className="flex-1" />
      )}
      {onComplete ? (
        <Button size="xs" variant="outline" className="ml-auto" onClick={onComplete}>
          Complete sprint
        </Button>
      ) : null}
    </div>
  );
}
