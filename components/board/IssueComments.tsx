"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Trash2 } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { Avatar } from "@/components/board/Avatar";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSession } from "@/lib/auth-client";
import {
  addComment,
  deleteComment,
  fetchComments,
  type IssueComment,
} from "@/lib/api/comments";
import { issueKeys } from "@/lib/api/issues";

/** Comment thread for an issue: oldest first, Markdown bodies, add + delete own. */
export function IssueComments({ issueId }: { issueId: string }) {
  const queryClient = useQueryClient();
  const session = useSession();
  const myId = session.data?.user.id;
  const [body, setBody] = useState("");

  const commentsQuery = useQuery({
    queryKey: issueKeys.comments(issueId),
    queryFn: () => fetchComments(issueId),
  });

  const add = useMutation({
    mutationFn: (value: string) => addComment(issueId, value),
    onSuccess: (comment) => {
      setBody("");
      queryClient.setQueryData<IssueComment[]>(issueKeys.comments(issueId), (prev) => [
        ...(prev ?? []),
        comment,
      ]);
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

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">Comments</span>
      {commentsQuery.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : commentsQuery.isError ? (
        <p className="text-sm text-muted-foreground">{(commentsQuery.error as Error).message}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {commentsQuery.data.map((comment) => (
            <li key={comment.id} className="group flex gap-2">
              {comment.author ? (
                <Avatar person={comment.author} className="mt-0.5" />
              ) : (
                <span className="mt-0.5 size-5 shrink-0 rounded-full bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {comment.author?.name ?? "Deleted user"}
                  </span>
                  <span>
                    {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                    {comment.editedAt ? " · edited" : ""}
                  </span>
                  {comment.author?.id === myId && !comment.authorAgentId ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete comment"
                      className="ml-auto opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                      onClick={() => remove.mutate(comment.id)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none break-words text-sm [&_code]:rounded [&_code]:bg-muted [&_code]:px-1">
                  <ReactMarkdown>{comment.body}</ReactMarkdown>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="flex flex-col items-end gap-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Leave a comment… (Markdown supported)"
          aria-label="New comment"
          rows={2}
          className="resize-none"
          maxLength={10_000}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button type="submit" size="sm" loading={add.isPending} disabled={!body.trim()}>
          Comment
        </Button>
      </form>
    </div>
  );
}
