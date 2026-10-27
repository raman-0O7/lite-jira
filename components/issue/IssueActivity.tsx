"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { Bot, Trash2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { Avatar } from "@/components/icons/Avatar";
import { StatusIcon } from "@/components/icons/StatusIcon";
import { useCan } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { addComment, deleteComment, fetchComments, type IssueComment } from "@/lib/api/comments";
import {
  fetchIssueActivity,
  issueKeys,
  type IssueActivity as Activity,
  type IssueActivityEntry,
} from "@/lib/api/issues";
import type { IssueType, Priority } from "@/lib/api/projects";
import { useSession } from "@/lib/auth-client";
import { variantForCategory, type StatusVariant } from "@/lib/status";
import { ISSUE_TYPE_LABEL, PRIORITY_LABEL } from "@/lib/task-meta";

/** Markdown for comments and descriptions, styled with the app's tokens. */
export const MARKDOWN_CLASS =
  "max-w-none break-words text-sm leading-relaxed text-soft [&_a]:text-primary-text [&_a]:underline [&_code]:rounded [&_code]:bg-chip [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.85em] [&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:font-heading [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:text-sm [&_h2]:font-semibold [&_h2]:text-foreground [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1.5 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-field [&_pre]:p-2 [&_ul]:list-disc [&_ul]:pl-5 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0";

type Change = { from?: unknown; to?: unknown; added?: string[]; removed?: string[] };

type TimelineItem =
  | { kind: "event"; at: string; entry: IssueActivityEntry; parts: React.ReactNode[] }
  | { kind: "comment"; at: string; comment: IssueComment };

export function ago(at: string) {
  const date = new Date(at);
  if (Date.now() - date.getTime() < 45_000) return "just now";
  return formatDistanceToNowStrict(date, { addSuffix: true });
}

function Strong({ children }: { children: React.ReactNode }) {
  return <span className="font-medium text-soft">{children}</span>;
}

/** The sentences one activity row turns into ("set priority to High", …). */
function describe(
  entry: IssueActivityEntry,
  refs: Activity["refs"],
  variantFor: (columnId: string) => StatusVariant,
): React.ReactNode[] {
  const person = (id: unknown) => (typeof id === "string" ? refs.people[id]?.name : undefined) ?? "a former member";
  const column = (id: unknown) => {
    const ref = typeof id === "string" ? refs.columns[id] : undefined;
    if (!ref) return <Strong>a deleted column</Strong>;
    return (
      <span className="inline-flex items-center gap-1 align-[-2px]">
        <StatusIcon variant={variantFor(ref.id) ?? variantForCategory(ref.category)} />
        <Strong>{ref.name}</Strong>
      </span>
    );
  };
  const data = entry.data;
  const agent = (id: unknown) => <Strong>{(typeof id === "string" ? refs.agents?.[id]?.name : undefined) ?? "a deleted agent"}</Strong>;
  const link = (href: unknown, label: string) =>
    typeof href === "string" ? (
      <a href={href} target="_blank" rel="noreferrer" className="font-medium text-primary-text hover:underline">
        {label}
      </a>
    ) : (
      label
    );

  switch (entry.action) {
    case "agent.assigned":
      // A first assignment already reads "assigned it to …" from the field change.
      return data.retry ? [<>retried {agent(data.agentId)}’s run</>] : [];
    case "agent.claimed":
      return [<>started working on it</>];
    case "agent.progress":
      return data.status === "NEEDS_INPUT" ? [<>needs input</>] : [];
    case "agent.pr_opened":
      return [<>opened a {link(data.prUrl, "pull request")}</>];
    case "agent.done":
      return [<>finished: the {link(data.prUrl, "pull request")} was merged</>];
    case "agent.failed":
      return [<>run failed{typeof data.error === "string" ? <>: <Strong>{data.error}</Strong></> : null}</>];
    case "agent.released":
      return [<>gave the issue back{typeof data.reason === "string" ? <>: <Strong>{data.reason}</Strong></> : null}</>];
  }

  if (entry.action === "issue.created") {
    return [
      <>
        created the issue{data.columnId ? <> in {column(data.columnId)}</> : null}
      </>,
    ];
  }
  if (entry.action === "issue.moved") {
    if (data.fromColumnId === data.toColumnId) return [];
    return [
      <>
        moved it from {column(data.fromColumnId)} to {column(data.toColumnId)}
      </>,
    ];
  }

  const changes = (data.changes ?? {}) as Record<string, Change | true>;
  const parts: React.ReactNode[] = [];
  for (const [field, raw] of Object.entries(changes)) {
    const value = (raw === true ? {} : raw) as Change;
    switch (field) {
      case "title":
        parts.push(<>renamed it to <Strong>“{String(value.to)}”</Strong></>);
        break;
      case "priority":
        parts.push(<>set priority to <Strong>{PRIORITY_LABEL[value.to as Priority] ?? String(value.to)}</Strong></>);
        break;
      case "type":
        parts.push(<>changed the type to <Strong>{ISSUE_TYPE_LABEL[value.to as IssueType] ?? String(value.to)}</Strong></>);
        break;
      case "assigneeAgentId":
        if (value.to) parts.push(<>assigned it to {agent(value.to)}</>);
        else if (!changes.assigneeUserId) parts.push(<>unassigned {agent(value.from)}</>);
        break;
      case "assigneeUserId":
        // Assigning an agent clears the person; the agent sentence covers it.
        if (!value.to && changes.assigneeAgentId) break;
        if (!value.to) parts.push(<>removed the assignee</>);
        else if (value.to === entry.actor?.id) parts.push(<>self-assigned the issue</>);
        else parts.push(<>assigned it to <Strong>{person(value.to)}</Strong></>);
        break;
      case "dueDate":
        parts.push(
          value.to ? (
            <>set the due date to <Strong>{format(new Date(String(value.to)), "MMM d, yyyy")}</Strong></>
          ) : (
            <>removed the due date</>
          ),
        );
        break;
      case "estimate":
        parts.push(value.to != null ? <>set the estimate to <Strong>{String(value.to)}</Strong></> : <>removed the estimate</>);
        break;
      case "epicId": {
        const epic = typeof value.to === "string" ? refs.issues[value.to] : undefined;
        parts.push(value.to ? <>added it to epic <Strong>{epic?.key ?? "a deleted epic"}</Strong></> : <>removed it from its epic</>);
        break;
      }
      case "description":
        parts.push(<>updated the description</>);
        break;
      case "acceptanceCriteria":
        parts.push(<>updated the acceptance criteria</>);
        break;
      case "labels": {
        const names = (ids: string[] = []) => ids.map((id) => refs.labels[id]?.name ?? "a deleted label").join(", ");
        if (value.added?.length) parts.push(<>added <Strong>{names(value.added)}</Strong></>);
        if (value.removed?.length) parts.push(<>removed <Strong>{names(value.removed)}</Strong></>);
        break;
      }
    }
  }
  return parts;
}

function actorName(entry: IssueActivityEntry) {
  if (entry.agent) return entry.agent.name;
  if (entry.actor) return entry.actor.name;
  if (entry.actorType === "AGENT") return "An agent";
  if (entry.actorType === "GITHUB") return "GitHub";
  return "Kanso";
}

function EventRow({ entry, part }: { entry: IssueActivityEntry; part: React.ReactNode }) {
  return (
    <li className="relative flex items-start gap-3 py-1.5 text-xs text-muted-foreground">
      <span className="relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full bg-background">
        {entry.actorType === "AGENT" || entry.agent ? (
          <Bot className="size-3.5 text-review" />
        ) : entry.actor ? (
          <Avatar person={entry.actor} size="xs" />
        ) : (
          <span className="size-1.5 rounded-full bg-grey" />
        )}
      </span>
      <p className="min-w-0 flex-1 pt-[3px] leading-[14px]">
        <span className="font-medium text-soft">{actorName(entry)}</span> {part}
        <span className="text-muted-foreground/80" title={format(new Date(entry.createdAt), "PPpp")}>
          {" · "}
          {ago(entry.createdAt)}
        </span>
      </p>
    </li>
  );
}

function CommentRow({
  comment,
  canDelete,
  onDelete,
}: {
  comment: IssueComment;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <li className="relative flex items-start gap-3 py-2">
      <span className="relative z-10 shrink-0 rounded-full bg-background">
        {comment.authorAgent ? (
          <span className="flex size-5 items-center justify-center rounded-full bg-chip">
            <Bot className="size-3.5 text-review" />
          </span>
        ) : comment.author ? (
          <Avatar person={comment.author} size="sm" />
        ) : (
          <span className="block size-5 rounded-full bg-chip" />
        )}
      </span>
      <div className="group min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 shadow-card">
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="font-medium text-foreground">
            {comment.authorAgent?.name ?? comment.author?.name ?? "Deleted user"}
          </span>
          {comment.authorAgent ? (
            <span className="rounded bg-chip px-1 text-2xs text-muted-foreground">
              Agent{comment.author ? ` · for ${comment.author.name}` : ""}
            </span>
          ) : null}
          <span className="text-muted-foreground" title={format(new Date(comment.createdAt), "PPpp")}>
            {ago(comment.createdAt)}
            {comment.editedAt ? " · edited" : ""}
          </span>
          {canDelete ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Delete comment"
              className="ml-auto -my-1 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          ) : null}
        </div>
        <div className={MARKDOWN_CLASS}>
          <ReactMarkdown>{comment.body}</ReactMarkdown>
        </div>
      </div>
    </li>
  );
}

/**
 * The issue's timeline: history (created, field changes, moves) and comments
 * merged by time, oldest first, with the comment composer at the bottom.
 */
export function IssueActivity({
  issueId,
  variants,
}: {
  issueId: string;
  /** Status icons as the board shows them, when the project's columns are loaded. */
  variants?: Map<string, StatusVariant>;
}) {
  const queryClient = useQueryClient();
  const session = useSession();
  const myId = session.data?.user.id;
  const canComment = useCan("comment.write");
  const canModerate = useCan("comment.moderate");
  const [body, setBody] = useState("");

  const commentsQuery = useQuery({
    queryKey: issueKeys.comments(issueId),
    queryFn: () => fetchComments(issueId),
  });
  const activityQuery = useQuery({
    queryKey: issueKeys.activity(issueId),
    queryFn: () => fetchIssueActivity(issueId),
  });

  const add = useMutation({
    mutationFn: (value: string) => addComment(issueId, value),
    onSuccess: (comment) => {
      setBody("");
      queryClient.setQueryData<IssueComment[]>(issueKeys.comments(issueId), (prev) => [...(prev ?? []), comment]);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteComment(id),
    onSuccess: (_data, id) => {
      queryClient.setQueryData<IssueComment[]>(issueKeys.comments(issueId), (prev) =>
        (prev ?? []).filter((c) => c.id !== id),
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = body.trim();
    if (trimmed) add.mutate(trimmed);
  }

  const variantFor = (columnId: string): StatusVariant => {
    const known = variants?.get(columnId);
    if (known) return known;
    const ref = activityQuery.data?.refs.columns[columnId];
    return ref ? variantForCategory(ref.category) : "started";
  };

  const items: TimelineItem[] = [];
  if (activityQuery.data) {
    for (const entry of activityQuery.data.entries) {
      const parts = describe(entry, activityQuery.data.refs, variantFor);
      if (parts.length) items.push({ kind: "event", at: entry.createdAt, entry, parts });
    }
  }
  for (const comment of commentsQuery.data ?? []) {
    items.push({ kind: "comment", at: comment.createdAt, comment });
  }
  items.sort((a, b) => a.at.localeCompare(b.at));

  const loading = commentsQuery.isPending || activityQuery.isPending;
  const error = commentsQuery.error ?? activityQuery.error;

  return (
    <section aria-label="Activity" className="flex flex-col gap-2">
      <h2 className="font-heading text-sm font-semibold text-foreground">Activity</h2>
      {loading ? (
        <p className="py-2 text-xs text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="py-2 text-xs text-muted-foreground">{(error as Error).message}</p>
      ) : (
        <ol className="relative before:absolute before:top-3 before:bottom-3 before:left-[9.5px] before:w-px before:bg-border">
          {items.map((item) =>
            item.kind === "comment" ? (
              <CommentRow
                key={item.comment.id}
                comment={item.comment}
                canDelete={(item.comment.author?.id === myId && !item.comment.authorAgentId) || canModerate}
                onDelete={() => remove.mutate(item.comment.id)}
              />
            ) : (
              item.parts.map((part, index) => (
                <EventRow key={`${item.entry.id}:${index}`} entry={item.entry} part={part} />
              ))
            ),
          )}
        </ol>
      )}
      {canComment ? (
        <form
          onSubmit={submit}
          className="mt-1 flex flex-col rounded-lg border bg-field focus-within:border-ring/60 focus-within:ring-3 focus-within:ring-ring/20"
        >
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Leave a comment…"
            aria-label="New comment"
            rows={2}
            maxLength={10_000}
            className="field-sizing-content max-h-72 min-h-14 resize-none bg-transparent px-3 pt-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="flex items-center justify-between gap-2 px-2 pt-1 pb-2">
            <span className="pl-1 text-2xs text-muted-foreground">Markdown supported · ⌘↵ to send</span>
            <Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()}>
              Comment
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

