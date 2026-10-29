"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ListTree, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";

import { GitHubMark } from "@/components/icons/GitHubMark";
import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { PriorityIcon } from "@/components/icons/PriorityIcon";
import { AssigneeAvatars, cardRunStatus, RunStatusBadge } from "@/components/issue/AgentBadges";
import { DueDate } from "@/components/issue/DueDate";
import { PullRequestBadge } from "@/components/issue/GitHubBadges";
import { LabelChip } from "@/components/issue/LabelChip";
import { useCan } from "@/components/providers/workspace-provider";
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
import type { IssueCard } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

/** The card's face, shared by the sortable card and the drag overlay. */
export function IssueCardFace({ issue, menu }: { issue: IssueCard; menu?: React.ReactNode }) {
  const hasMeta =
    issue.labels.length > 0 ||
    issue.subIssueCount > 0 ||
    issue.estimate !== null ||
    issue.dueDate !== null ||
    issue.assignee !== null ||
    Boolean(issue.assigneeAgent) ||
    Boolean(issue.pullRequests?.length) ||
    issue.source === "GITHUB";
  const runStatus = cardRunStatus(issue.agentRuns);
  return (
    <>
      <div className="flex h-4 items-center gap-1.5">
        <IssueTypeIcon type={issue.type} />
        <span className="font-mono text-2xs text-muted-foreground">{issue.key}</span>
        <span className="ml-auto flex items-center gap-1">
          {menu}
          <PriorityIcon priority={issue.priority} />
        </span>
      </div>
      <p className="line-clamp-3 font-medium break-words text-foreground">{issue.title}</p>
      {hasMeta ? (
        <div className="flex min-h-5 flex-wrap items-center gap-1.5">
          {issue.labels.map((label) => (
            <LabelChip key={label.id} label={label} />
          ))}
          {issue.subIssueCount > 0 ? (
            <span
              className="inline-flex items-center gap-1 text-2xs text-muted-foreground tabular"
              title={`${issue.subIssueDoneCount} of ${issue.subIssueCount} sub-issues done`}
            >
              <ListTree className="size-3" />
              {issue.subIssueDoneCount}/{issue.subIssueCount}
            </span>
          ) : null}
          {issue.estimate !== null ? (
            <span
              className="inline-flex h-[18px] items-center rounded-[5px] border px-1 text-2xs text-muted-foreground tabular"
              title="Estimate (points)"
            >
              {issue.estimate}
            </span>
          ) : null}
          {issue.dueDate ? <DueDate value={issue.dueDate} /> : null}
          {issue.githubLink ? (
            <span
              className="inline-flex items-center text-muted-foreground"
              title={`Imported from ${issue.githubLink.repoFullName}#${issue.githubLink.number}`}
            >
              <GitHubMark className="size-3" />
            </span>
          ) : null}
          {issue.pullRequests?.length ? <PullRequestBadge pullRequests={issue.pullRequests} /> : null}
          {runStatus ? <RunStatusBadge status={runStatus} name={issue.assigneeAgent?.name} kind={issue.assigneeAgent?.kind} /> : null}
          <AssigneeAvatars person={issue.assignee} agent={issue.assigneeAgent} className="ml-auto" />
        </div>
      ) : null}
    </>
  );
}

const CARD =
  "group relative flex flex-col gap-2 rounded-lg border bg-surface px-[11px] py-2.5 text-sm shadow-card";

/** A card while it's being dragged (rendered in the DragOverlay). */
export function IssueCardOverlay({ issue }: { issue: IssueCard }) {
  return (
    <div className={cn(CARD, "w-[264px] rotate-[1.5deg] cursor-grabbing border-primary/40 shadow-popover")}>
      <IssueCardFace issue={issue} />
    </div>
  );
}

/** A draggable issue card on the board. A plain click opens the issue. */
export function BoardIssueCard({
  issue,
  busy,
  onDelete,
  onOpen,
}: {
  issue: IssueCard;
  /** Disable controls while a mutation touching this card is in flight. */
  busy?: boolean;
  onDelete: () => void;
  onOpen?: () => void;
}) {
  const canEdit = useCan("issue.write");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: issue.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const menu = canEdit ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Actions for ${issue.key}`}
          disabled={busy}
          // Stop drag + card-open from firing when opening the menu.
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className="size-5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  return (
    <>
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={onOpen}
        onKeyDown={(event) => {
          // Space picks the card up (dnd-kit's keyboard sensor); Enter opens it.
          if (event.key === "Enter" && !isDragging && onOpen) onOpen();
          listeners?.onKeyDown?.(event);
        }}
        aria-label={`${issue.key}: ${issue.title}`}
        className={cn(
          CARD,
          "touch-none outline-none hover:border-foreground/15 focus-visible:ring-2 focus-visible:ring-ring/60",
          canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
          // The DragOverlay shows the moving copy; leave a placeholder here.
          isDragging && "border-dashed bg-transparent shadow-none [&>*]:invisible",
        )}
      >
        <IssueCardFace issue={issue} menu={menu} />
      </div>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {issue.key}?</DialogTitle>
            <DialogDescription>This deletes “{issue.title}”. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                onDelete();
                setDeleteOpen(false);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
