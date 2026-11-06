"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Sparkles } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { useCanUseAi } from "@/components/ai/use-ai";
import { Kbd } from "@/components/icons/Kbd";
import { ProjectTile } from "@/components/icons/ProjectTile";
import { PendingImages } from "@/components/issue/IssueActivity";
import { AssigneePicker, PriorityPicker, StatusPicker, TypePicker } from "@/components/issue/IssueFields";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useAssigneeShortcuts } from "@/components/workspace/AssigneeShortcuts";
import { draftIssueWithAi } from "@/lib/api/ai";
import { ATTACHMENT_TYPES, MAX_ATTACHMENTS, mergeImages } from "@/lib/api/comments";
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
import { cn } from "@/lib/utils";

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
  sprintId = null,
  open,
  onOpenChange,
  onCreated,
}: {
  project: ProjectDetail;
  /** The status to start in; defaults to the first column. */
  columnId: string | null;
  /** Scrum projects: the sprint it starts in (null → the backlog). */
  sprintId?: string | null;
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
            sprintId={sprintId}
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
  sprintId,
  close,
  onCreated,
}: {
  project: ProjectDetail;
  columnId: string | null;
  sprintId: string | null;
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
  const [images, setImages] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function addImages(files: File[]) {
    const result = mergeImages(images, files);
    if (result.warning) toast.error(result.warning);
    if (result.error) toast.error(result.error);
    else setImages(result.files);
  }

  // "Fill in": the note so far becomes the issue's fields, for the person to review.
  const canUseAi = useCanUseAi();
  const fillIn = useMutation({
    mutationFn: () => draftIssueWithAi(project.id, [draft.title, draft.description].filter((t) => t.trim()).join("\n\n")),
    onSuccess: (suggestion) => {
      const before = draft;
      set({
        title: suggestion.title,
        description: suggestion.description ?? "",
        type: suggestion.type,
        priority: suggestion.priority,
        assigneeUserId: suggestion.assigneeUserId,
      });
      toast("Filled in by AI. Check it before creating.", {
        action: { label: "Undo", onClick: () => setDraft(before) },
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const hasText = Boolean(draft.title.trim() || draft.description.trim());

  const create = useMutation({
    mutationFn: ({ columnId: target, ...fields }: Draft & { columnId: string }) =>
      createIssue(
        target,
        {
          title: fields.title.trim(),
          description: fields.description.trim() || null,
          type: fields.type,
          priority: fields.priority,
          assigneeUserId: fields.assigneeUserId,
          ...(sprintId ? { sprintId } : {}),
        },
        images,
      ),
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
      if (project.mode === "SCRUM") queryClient.invalidateQueries({ queryKey: ["sprints", project.id] });
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
        className={cn("relative flex flex-col", dragging && "rounded-lg ring-2 ring-primary/60 ring-inset")}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragging(false);
          addImages(Array.from(event.dataTransfer.files));
        }}
        onPaste={(event) => {
          const pasted = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
          if (!pasted.length) return;
          event.preventDefault();
          addImages(pasted);
        }}
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
        {dragging ? (
          <p className="px-4 pb-2 text-xs text-primary-text">Drop images to attach them to this issue</p>
        ) : null}
        <PendingImages files={images} onRemove={(index) => setImages(images.filter((_, i) => i !== index))} />
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
          <input
            ref={fileInput}
            type="file"
            accept={ATTACHMENT_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(event) => {
              addImages(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Attach images"
            title="Attach images (or drop or paste them)"
            disabled={images.length >= MAX_ATTACHMENTS}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus />
          </Button>
          {canUseAi ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title="Turn what you wrote into a title, description, type, priority and assignee"
              disabled={!hasText || create.isPending}
              loading={fillIn.isPending}
              loadingText="Filling in…"
              onClick={() => fillIn.mutate()}
            >
              <Sparkles />
              Fill in
            </Button>
          ) : null}
          <span className="mr-auto hidden items-center gap-1 text-2xs text-muted-foreground sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
            to create
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={fillIn.isPending} loading={create.isPending} loadingText="Creating…">
            Create issue
          </Button>
        </div>
      </form>
      {assigneeShortcuts.dialogs}
    </>
  );
}
