"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Columns3, List, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { PageHeader, PageTitle } from "@/components/app-shell/PageHeader";
import { useRegisterNewIssue } from "@/components/app-shell/app-ui";
import { AvatarStack } from "@/components/icons/Avatar";
import { Kbd } from "@/components/icons/Kbd";
import { ProjectTile } from "@/components/icons/ProjectTile";
import { IssuePanel } from "@/components/issue/IssuePanel";
import { NewIssueDialog } from "@/components/issue/NewIssueDialog";
import { ProjectSkeleton } from "@/components/loading/skeletons";
import { KanbanBoard } from "@/components/project/board/KanbanBoard";
import { FilterBar } from "@/components/project/filters/FilterBar";
import { IssueList } from "@/components/project/list/IssueList";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
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
  type LabelStub,
  type PersonStub,
  type ProjectDetail,
} from "@/lib/api/projects";
import { isFiltersEmpty, matchesFilters } from "@/lib/board-filters";
import { statusVariants } from "@/lib/status";
import { cn } from "@/lib/utils";

type View = "board" | "list";

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
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useBoardFilters();
  const searchRef = useRef<HTMLInputElement>(null);

  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [newIssue, setNewIssue] = useState<{ open: boolean; columnId: string | null }>({
    open: false,
    columnId: null,
  });

  const view: View = searchParams.get("view") === "list" ? "list" : "board";
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

  const project = projectQuery.data;
  const columns = project?.columns ?? [];
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
    replaceParam(pathname, "view", next === "list" ? "list" : null);
  }

  function startNewIssue(columnId: string | null = null) {
    setNewIssue({ open: true, columnId });
  }

  useRegisterNewIssue(project && canEditIssues && columns.length > 0 ? () => startNewIssue() : null);

  const overlayOpen = newIssue.open || addColumnOpen || openIssue !== null;
  useHotkeys(
    {
      "/": () => searchRef.current?.focus(),
      "g b": () => setView("board"),
      "g l": () => setView("list"),
    },
    !overlayOpen,
  );

  if (projectQuery.isPending) {
    return <ProjectSkeleton view={view} />;
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
    if (!filtersActive) return column.issues;
    return column.issues.filter((issue) => matchesFilters(issue, filters.filters));
  }
  const variants = statusVariants(columns);
  const doneColumnIds = new Set(columns.filter((c) => c.category === "DONE").map((c) => c.id));
  const progress = {
    total: allIssues.length,
    done: allIssues.filter((i) => doneColumnIds.has(i.columnId)).length,
  };
  const assignees = deriveAssignees(columns);

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
            <ThemeToggle />
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
        <PageTitle className="sr-only sm:not-sr-only">{view === "list" ? "List" : "Board"}</PageTitle>
        <div
          role="tablist"
          aria-label="View"
          className="ml-1 flex h-7 shrink-0 items-center rounded-md bg-chip p-0.5"
        >
          {(
            [
              { id: "board", label: "Board", icon: Columns3 },
              { id: "list", label: "List", icon: List },
            ] as const
          ).map(({ id, label, icon: Icon }) => (
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
              {label}
            </button>
          ))}
        </div>
      </PageHeader>

      <FilterBar
        labels={deriveLabels(columns)}
        filters={filters}
        progress={progress}
        searchRef={searchRef}
      />

      <div className="min-h-0 flex-1">
        {view === "board" ? (
          <div className="h-full overflow-x-auto overflow-y-hidden px-4 pt-3 md:px-5">
            <KanbanBoard
              projectId={projectId}
              columns={columns}
              columnsBusy={rename.isPending || removeColumn.isPending}
              filters={filters.filters}
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
        open={newIssue.open}
        onOpenChange={(open) => setNewIssue((prev) => ({ ...prev, open }))}
        onCreated={(issue) => openIssueByKey(issue.key)}
      />

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
