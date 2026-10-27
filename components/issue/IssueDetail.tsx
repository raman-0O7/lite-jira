"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { Avatar } from "@/components/icons/Avatar";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { DueDatePicker } from "@/components/issue/DueDatePicker";
import { ago, IssueActivity, MARKDOWN_CLASS } from "@/components/issue/IssueActivity";
import {
  AssigneePicker,
  EpicPicker,
  EstimateInput,
  PriorityPicker,
  StatusPicker,
  TypePicker,
} from "@/components/issue/IssueFields";
import { LabelChip } from "@/components/issue/LabelChip";
import { LabelPicker } from "@/components/issue/LabelPicker";
import { IssueGitHub } from "@/components/issue/IssueGitHub";
import { SubIssues } from "@/components/issue/SubIssues";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
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
  fetchIssue,
  issueKeys,
  moveIssue,
  updateIssue,
  type IssueFull,
  type UpdateIssuePayload,
} from "@/lib/api/issues";
import { labelKeys } from "@/lib/api/labels";
import { fetchMembers, memberKeys } from "@/lib/api/members";
import {
  fetchProject,
  projectKeys,
  type IssueCard,
  type LabelStub,
  type PersonStub,
  type ProjectDetail,
} from "@/lib/api/projects";
import { statusVariants } from "@/lib/status";
import { ISSUE_TYPE_LABEL } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

/** The title: a borderless, auto-growing heading that saves on blur or Enter. */
function TitleField({
  value,
  disabled,
  onSave,
}: {
  value: string;
  disabled: boolean;
  onSave: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) setDraft(value);
    else onSave(trimmed);
  }

  return (
    <textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          setDraft(value);
          event.currentTarget.blur();
        }
      }}
      readOnly={disabled}
      rows={1}
      maxLength={200}
      aria-label="Issue title"
      className="field-sizing-content w-full resize-none rounded-md bg-transparent font-heading text-[22px] leading-tight font-semibold tracking-[-0.02em] text-foreground outline-none read-only:cursor-default"
    />
  );
}

/** Markdown text that turns into a textarea on click (for those who can edit). */
function MarkdownField({
  label,
  value,
  emptyText,
  placeholder,
  disabled,
  onSave,
}: {
  label: string;
  value: string | null;
  emptyText: string;
  placeholder: string;
  disabled: boolean;
  onSave: (next: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");

  function start() {
    setDraft(value ?? "");
    setEditing(true);
  }

  function save() {
    setEditing(false);
    const next = draft.trim() ? draft : null;
    if (next !== (value || null)) onSave(next);
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              save();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setEditing(false);
            }
          }}
          placeholder={placeholder}
          aria-label={label}
          autoFocus
          maxLength={10_000}
          className="field-sizing-content min-h-28 w-full resize-none rounded-lg border bg-field px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring/60 focus:ring-3 focus:ring-ring/20"
        />
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={save}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
          <span className="ml-auto text-2xs text-muted-foreground">Markdown · ⌘↵ to save · Esc to cancel</span>
        </div>
      </div>
    );
  }

  if (!value) {
    return disabled ? (
      <p className="text-sm text-muted-foreground">{emptyText}</p>
    ) : (
      <button
        type="button"
        onClick={start}
        className="-mx-2 rounded-md px-2 py-1 text-left text-sm text-muted-foreground hover:bg-accent/60"
      >
        {placeholder}
      </button>
    );
  }

  return (
    <div
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      aria-label={disabled ? undefined : `Edit ${label.toLowerCase()}`}
      onClick={(event) => {
        // Let links inside the Markdown work.
        if (disabled || (event.target as HTMLElement).closest("a")) return;
        start();
      }}
      onKeyDown={(event) => {
        if (!disabled && event.key === "Enter" && event.target === event.currentTarget) start();
      }}
      className={cn("-mx-2 rounded-md px-2 py-1", !disabled && "cursor-text hover:bg-accent/40", MARKDOWN_CLASS)}
    >
      <ReactMarkdown>{value}</ReactMarkdown>
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-[30px] grid-cols-[88px_minmax(0,1fr)] items-center gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-1.5 font-heading text-sm font-semibold text-foreground">{children}</h2>;
}

/**
 * An issue's content and properties, shared by the side panel and the full
 * page. Card-visible fields are patched optimistically in the project cache so
 * the board follows along; each save is field-scoped and rolls back on error.
 */
export function IssueDetail({
  issueId,
  projectId,
  onNavigate,
  onDelete,
}: {
  issueId: string;
  projectId: string;
  /** Open another issue (sub-issue, parent, epic) by key. */
  onNavigate: (key: string) => void;
  /** Delete the issue; the button only shows when given. */
  onDelete?: () => void;
}) {
  const queryClient = useQueryClient();
  const { slug } = useWorkspace();
  const canEdit = useCan("issue.write");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const issueQuery = useQuery({
    queryKey: issueKeys.detail(issueId),
    queryFn: () => fetchIssue(issueId),
  });
  const projectQuery = useQuery({
    queryKey: projectKeys.detail(projectId),
    queryFn: () => fetchProject(projectId),
  });
  const membersQuery = useQuery({
    queryKey: memberKeys.list(slug),
    queryFn: () => fetchMembers(slug),
  });

  const issue = issueQuery.data;
  const columns = projectQuery.data?.columns ?? [];
  const variants = statusVariants(columns);

  // ---- cache helpers -------------------------------------------------------

  function patchCard(fields: Partial<IssueCard>) {
    queryClient.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (prev) =>
      prev
        ? {
            ...prev,
            columns: prev.columns.map((column) => ({
              ...column,
              issues: column.issues.map((i) => (i.id === issueId ? { ...i, ...fields } : i)),
            })),
          }
        : prev,
    );
  }

  function patchFull(fields: Partial<IssueFull>) {
    queryClient.setQueryData<IssueFull>(issueKeys.detail(issueId), (prev) => (prev ? { ...prev, ...fields } : prev));
  }

  function snapshot() {
    return {
      project: queryClient.getQueryData<ProjectDetail>(projectKeys.detail(projectId)),
      issue: queryClient.getQueryData<IssueFull>(issueKeys.detail(issueId)),
    };
  }

  function restore(previous: ReturnType<typeof snapshot>) {
    if (previous.project) queryClient.setQueryData(projectKeys.detail(projectId), previous.project);
    if (previous.issue) queryClient.setQueryData(issueKeys.detail(issueId), previous.issue);
  }

  // ---- saves ---------------------------------------------------------------

  const save = useMutation({
    mutationFn: (vars: { payload: UpdateIssuePayload; previous: ReturnType<typeof snapshot> }) =>
      updateIssue(issueId, vars.payload),
    onSuccess: (updated) => {
      queryClient.setQueryData<IssueFull>(issueKeys.detail(issueId), updated);
      queryClient.invalidateQueries({ queryKey: issueKeys.activity(issueId) });
    },
    onError: (error: Error, vars) => {
      restore(vars.previous);
      toast.error(error.message);
    },
  });

  /** Apply the change to the caches now, then persist it. */
  function commit(payload: UpdateIssuePayload, card: Partial<IssueCard>, full: Partial<IssueFull> = {}) {
    const previous = snapshot();
    patchCard(card);
    patchFull({ ...card, ...full } as Partial<IssueFull>);
    save.mutate({ payload, previous });
  }

  // Status = column: the issue goes to the end of the chosen column.
  const move = useMutation({
    mutationFn: (vars: { toColumnId: string; toPosition: number; previous: ReturnType<typeof snapshot> }) =>
      moveIssue({ issueId, toColumnId: vars.toColumnId, toPosition: vars.toPosition }),
    onError: (error: Error, vars) => {
      restore(vars.previous);
      toast.error(error.message);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.activity(issueId) });
      queryClient.invalidateQueries({ queryKey: issueKeys.detail(issueId) });
      // Parents count done sub-issues; let the board catch up.
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    },
  });

  function changeStatus(columnId: string) {
    if (!issue || columnId === issue.columnId) return;
    const target = columns.find((c) => c.id === columnId);
    const card = columns.flatMap((c) => c.issues).find((i) => i.id === issueId);
    if (!target) return;
    const previous = snapshot();
    const toPosition = target.issues.filter((i) => i.id !== issueId).length;
    if (card) {
      queryClient.setQueryData<ProjectDetail>(projectKeys.detail(projectId), (prev) =>
        prev
          ? {
              ...prev,
              columns: prev.columns.map((column) => {
                const rest = column.issues.filter((i) => i.id !== issueId).map((i, index) => ({ ...i, position: index }));
                return column.id === columnId
                  ? { ...column, issues: [...rest, { ...card, columnId, position: rest.length }] }
                  : { ...column, issues: rest };
              }),
            }
          : prev,
      );
    }
    patchFull({ columnId, column: { id: target.id, name: target.name, category: target.category } });
    move.mutate({ toColumnId: columnId, toPosition, previous });
  }

  function changeAssignee(next: string | null) {
    if (!issue || next === issue.assigneeUserId) return;
    const member = membersQuery.data?.find((m) => m.id === next);
    const assignee: PersonStub | null = member ? { id: member.id, name: member.name, image: member.image } : null;
    commit({ assigneeUserId: next }, { assignee }, { assigneeUserId: next });
  }

  function changeLabels(nextIds: string[]) {
    if (!issue) return;
    const known = [
      ...issue.labels,
      ...(queryClient.getQueryData<LabelStub[]>(labelKeys.project(projectId)) ?? []),
    ];
    const labels = nextIds
      .map((id) => known.find((l) => l.id === id))
      .filter((l): l is LabelStub => Boolean(l));
    commit({ labelIds: nextIds }, { labels });
  }

  // ---- render --------------------------------------------------------------

  if (issueQuery.isPending) {
    return <p className="flex-1 p-8 text-center text-sm text-muted-foreground">Loading issue…</p>;
  }
  if (issueQuery.isError || !issue) {
    return (
      <p className="flex-1 p-8 text-center text-sm text-muted-foreground">
        {(issueQuery.error as Error | null)?.message ?? "Issue not found"}
      </p>
    );
  }

  const epics = columns
    .flatMap((c) => c.issues)
    .filter((i) => i.type === "EPIC" && i.id !== issue.id)
    .map((i) => ({ id: i.id, key: i.key, title: i.title }));
  const statusColumns = columns.length
    ? columns
    : [{ id: issue.column.id, name: issue.column.name, category: issue.column.category }];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <div className="min-w-0 flex-1 md:overflow-y-auto">
        <div className="mx-auto flex max-w-[760px] flex-col gap-6 px-5 py-5 md:px-8 md:py-6">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <IssueTypeIcon type={issue.type} />
              <span>{ISSUE_TYPE_LABEL[issue.type]}</span>
              {issue.parent ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>sub-issue of</span>
                  <button
                    type="button"
                    onClick={() => onNavigate(issue.parent!.key)}
                    className="font-mono text-2xs text-soft hover:text-foreground hover:underline"
                  >
                    {issue.parent.key}
                  </button>
                </>
              ) : null}
              {issue.epic ? (
                <>
                  <span aria-hidden="true">·</span>
                  <span>in</span>
                  <button
                    type="button"
                    onClick={() => onNavigate(issue.epic!.key)}
                    className="inline-flex min-w-0 items-center gap-1 text-soft hover:text-foreground hover:underline"
                  >
                    <IssueTypeIcon type="EPIC" decorative />
                    <span className="max-w-60 truncate">{issue.epic.title}</span>
                  </button>
                </>
              ) : null}
            </div>
            <TitleField value={issue.title} disabled={!canEdit} onSave={(title) => commit({ title }, { title })} />
          </div>

          <section aria-label="Description">
            <MarkdownField
              label="Description"
              value={issue.description}
              emptyText="No description."
              placeholder="Add a description…"
              disabled={!canEdit}
              onSave={(description) => commit({ description }, {}, { description })}
            />
          </section>

          {issue.acceptanceCriteria || canEdit ? (
            <section aria-label="Acceptance criteria">
              <SectionHeading>Acceptance criteria</SectionHeading>
              <MarkdownField
                label="Acceptance criteria"
                value={issue.acceptanceCriteria}
                emptyText="None yet."
                placeholder="What has to be true for this to be done?"
                disabled={!canEdit}
                onSave={(acceptanceCriteria) => commit({ acceptanceCriteria }, {}, { acceptanceCriteria })}
              />
            </section>
          ) : null}

          {issue.type !== "SUBTASK" && issue.type !== "EPIC" ? (
            <SubIssues issue={issue} onOpen={onNavigate} />
          ) : null}

          <div className="border-t pt-5">
            <IssueActivity issueId={issue.id} variants={variants} />
          </div>
        </div>
      </div>

      <aside
        aria-label="Properties"
        className="shrink-0 border-t bg-[color-mix(in_srgb,var(--background)_94%,var(--foreground))] px-3 py-4 md:w-[264px] md:overflow-y-auto md:border-t-0 md:border-l"
      >
        <div className="flex flex-col gap-0.5">
          <PropertyRow label="Status">
            <StatusPicker
              columns={statusColumns}
              value={issue.columnId}
              variants={variants}
              onChange={changeStatus}
              disabled={!canEdit || columns.length === 0}
            />
          </PropertyRow>
          <PropertyRow label="Priority">
            <PriorityPicker
              value={issue.priority}
              onChange={(priority) => priority !== issue.priority && commit({ priority }, { priority })}
              disabled={!canEdit}
            />
          </PropertyRow>
          <PropertyRow label="Assignee">
            <AssigneePicker
              value={issue.assigneeUserId}
              members={
                membersQuery.data ??
                (issue.assignee ? [{ ...issue.assignee, email: "", role: "MEMBER", joinedAt: "", projectIds: [] }] : [])
              }
              onChange={changeAssignee}
              disabled={!canEdit || !membersQuery.data}
            />
          </PropertyRow>
          <PropertyRow label="Type">
            <TypePicker
              value={issue.type}
              onChange={(type) => type !== issue.type && commit({ type }, { type })}
              disabled={!canEdit}
            />
          </PropertyRow>
          <PropertyRow label="Labels">
            <div className="flex flex-wrap items-center gap-1 px-1 py-1">
              {issue.labels.map((label) => (
                <LabelChip
                  key={label.id}
                  label={label}
                  onRemove={
                    canEdit
                      ? () => changeLabels(issue.labels.filter((l) => l.id !== label.id).map((l) => l.id))
                      : undefined
                  }
                />
              ))}
              {canEdit ? (
                <LabelPicker
                  projectId={projectId}
                  selectedIds={issue.labels.map((l) => l.id)}
                  onChange={changeLabels}
                  trigger={
                    <button
                      type="button"
                      aria-label="Edit labels"
                      className="flex h-5 items-center gap-1 rounded-full px-1.5 text-2xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Plus className="size-3" />
                      {issue.labels.length ? null : "Add label"}
                    </button>
                  }
                />
              ) : issue.labels.length === 0 ? (
                <span className="text-sm text-muted-foreground">None</span>
              ) : null}
            </div>
          </PropertyRow>
          <PropertyRow label="Estimate">
            <EstimateInput
              value={issue.estimate}
              onChange={(estimate) => commit({ estimate }, { estimate })}
              disabled={!canEdit}
            />
          </PropertyRow>
          <PropertyRow label="Due date">
            <DueDatePicker
              value={issue.dueDate}
              onChange={(dueDate) => commit({ dueDate }, { dueDate })}
              disabled={!canEdit}
            />
          </PropertyRow>
          {issue.type !== "EPIC" && issue.type !== "SUBTASK" ? (
            <PropertyRow label="Epic">
              <EpicPicker
                value={issue.epicId}
                epics={epics}
                onChange={(epicId) => {
                  if (epicId === issue.epicId) return;
                  const epic = epics.find((e) => e.id === epicId);
                  commit(
                    { epicId },
                    {},
                    {
                      epicId,
                      epic: epic ? { id: epic.id, key: epic.key, title: epic.title, number: 0, type: "EPIC" } : null,
                    },
                  );
                }}
                disabled={!canEdit}
              />
            </PropertyRow>
          ) : null}
        </div>

        <div className="mt-3 flex flex-col gap-0.5 border-t pt-3">
          <PropertyRow label="Reporter">
            {issue.reporter ? (
              <span className="flex items-center gap-2 px-2 text-sm text-foreground">
                <Avatar person={issue.reporter} size="xs" title={false} />
                <span className="truncate">{issue.reporter.name}</span>
              </span>
            ) : (
              <span className="px-2 text-sm text-muted-foreground">—</span>
            )}
          </PropertyRow>
          <PropertyRow label="Created">
            <span className="px-2 text-sm text-soft" title={format(new Date(issue.createdAt), "PPpp")}>
              {format(new Date(issue.createdAt), "MMM d, yyyy")}
            </span>
          </PropertyRow>
          <PropertyRow label="Updated">
            <span className="px-2 text-sm text-soft" title={format(new Date(issue.updatedAt), "PPpp")}>
              {ago(issue.updatedAt)}
            </span>
          </PropertyRow>
        </div>

        <IssueGitHub issue={issue} />

        {canEdit && onDelete ? (
          <div className="mt-3 border-t pt-3">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-danger"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 />
              Delete issue
            </Button>
          </div>
        ) : null}
      </aside>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {issue.key}?</DialogTitle>
            <DialogDescription>
              “{issue.title}” and its sub-issues will be deleted. This can’t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDelete(false);
                onDelete?.();
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
