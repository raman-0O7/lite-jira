"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Kbd } from "@/components/icons/Kbd";
import { ProjectTile } from "@/components/icons/ProjectTile";
import { AssigneePicker, PriorityPicker, StatusPicker, TypePicker } from "@/components/issue/IssueFields";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAssigneeShortcuts } from "@/components/workspace/AssigneeShortcuts";
import { createIssue } from "@/lib/api/issues";
import { fetchMembers, memberKeys } from "@/lib/api/members";
import {
  type IssueCard,
  type IssueType,
  type Priority,
  type ProjectDetail,
  projectKeys,
} from "@/lib/api/projects";
import { statusVariants } from "@/lib/status";

type Draft = {
  title: string;
  description: string;
  type: Exclude<IssueType, "SUBTASK">;
  priority: Priority;
  assigneeUserId: string | null;
  columnId: string | null;
};

/**
 * Create an issue with its title, description, status, type, priority, and
 * assignee. Mounted fresh on every open, seeded with the column it came from.
 */
export function NewIssueDialog({
  project,
  columnId,
  open,
  onOpenChange,
  onCreated,
}: {
  project: ProjectDetail;
  /** The status to start in; defaults to the first column. */
  columnId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (issue: IssueCard) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="top-[14vh] translate-y-0 gap-0 p-0 sm:max-w-[620px]">
        {open ? (
          <NewIssueForm
            project={project}
            columnId={columnId}
            close={() => onOpenChange(false)}
            onCreated={onCreated}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewIssueForm({
  project,
  columnId,
  close,
  onCreated,
}: {
  project: ProjectDetail;
  columnId: string | null;
  close: () => void;
  onCreated?: (issue: IssueCard) => void;
}) {
  const { slug } = useWorkspace();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>({
    title: "",
    description: "",
    type: "TASK",
    priority: "MEDIUM",
    assigneeUserId: null,
    columnId: columnId ?? project.columns[0]?.id ?? null,
  });
  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }));
  const membersQuery = useQuery({
    queryKey: memberKeys.list(slug),
    queryFn: () => fetchMembers(slug),
  });
  const assigneeShortcuts = useAssigneeShortcuts();

  const create = useMutation({
    mutationFn: ({ columnId: target, ...fields }: Draft & { columnId: string }) =>
      createIssue(target, {
        title: fields.title.trim(),
        description: fields.description.trim() || null,
        type: fields.type,
        priority: fields.priority,
        assigneeUserId: fields.assigneeUserId,
      }),
    onSuccess: (issue) => {
      queryClient.setQueryData<ProjectDetail>(projectKeys.detail(project.id), (prev) =>
        prev
          ? {
              ...prev,
              columns: prev.columns.map((c) =>
                c.id === issue.columnId ? { ...c, issues: [...c.issues, issue] } : c,
              ),
            }
          : prev,
      );
      close();
      toast.success(`${issue.key} created`, {
        action: onCreated ? { label: "Open", onClick: () => onCreated(issue) } : undefined,
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(event?: React.FormEvent) {
    event?.preventDefault();
    if (!draft.title.trim()) {
      toast.error("Title is required.");
      return;
    }
    if (!draft.columnId) {
      toast.error("Add a column to this project first.");
      return;
    }
    create.mutate({ ...draft, columnId: draft.columnId });
  }

  // The shortcut dialogs render outside the form: React bubbles their submit
  // events up the component tree, which would otherwise create this issue.
  return (
    <>
      <form
        onSubmit={submit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit(event);
        }}
        className="flex flex-col"
      >
        <div className="flex items-center gap-2 px-4 pt-3.5 text-xs text-muted-foreground">
          <ProjectTile projectKey={project.key} name={project.name} />
          <span>{project.name}</span>
          <span aria-hidden="true">›</span>
          <DialogTitle className="text-xs font-medium text-soft">New issue</DialogTitle>
        </div>
        <DialogDescription className="sr-only">
          Give the issue a title, and optionally a description, status, type, priority, and assignee.
        </DialogDescription>
        <div className="flex flex-col gap-1 px-4 pt-3 pb-2">
          <input
            autoFocus
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
            placeholder="Issue title"
            aria-label="Issue title"
            maxLength={200}
            className="w-full bg-transparent font-heading text-[19px] font-semibold tracking-[-0.015em] text-foreground outline-none placeholder:text-muted-foreground/70"
          />
          <textarea
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            placeholder="Add a description… (Markdown supported)"
            aria-label="Description"
            rows={4}
            maxLength={10_000}
            className="w-full resize-none bg-transparent text-sm leading-relaxed text-soft outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
          <StatusPicker
            look="pill"
            columns={project.columns}
            variants={statusVariants(project.columns)}
            value={draft.columnId}
            onChange={(next) => set({ columnId: next })}
          />
          <TypePicker look="pill" value={draft.type} onChange={(next) => set({ type: next as Draft["type"] })} />
          <PriorityPicker look="pill" value={draft.priority} onChange={(next) => set({ priority: next })} />
          <AssigneePicker
            look="pill"
            value={draft.assigneeUserId}
            members={membersQuery.data ?? []}
            onChange={(next) => set({ assigneeUserId: next })}
            shortcuts={assigneeShortcuts.shortcuts}
            disabled={!membersQuery.data}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-2.5">
          <span className="mr-auto hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
            to create
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={create.isPending} loadingText="Creating…">
            Create issue
          </Button>
        </div>
      </form>
      {assigneeShortcuts.dialogs}
    </>
  );
}
