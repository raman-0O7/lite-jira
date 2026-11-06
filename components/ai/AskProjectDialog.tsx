"use client";

import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Sparkles } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";

import { MARKDOWN_CLASS } from "@/components/issue/IssueActivity";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { askProjectAi } from "@/lib/api/ai";

const EXAMPLES = ["What’s blocked right now?", "What’s due this week?", "Who is working on what?"];

/** Issue keys of this project in an answer become links that open the issue. */
function linkKeys(answer: string, projectKey: string) {
  const pattern = new RegExp(`(?<![\\w/\\[#-])(${projectKey}-\\d+)\\b`, "gi");
  return answer.replace(pattern, (key) => `[${key.toUpperCase()}](#issue-${key.toUpperCase()})`);
}

/** "Ask": a question about the project, answered from its issues. Read-only. */
export function AskProjectDialog({
  project,
  open,
  onOpenChange,
  onOpenIssue,
}: {
  project: { id: string; key: string; name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenIssue: (key: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const ask = useMutation({ mutationFn: (q: string) => askProjectAi(project.id, q) });

  function submit(q = question) {
    const trimmed = q.trim();
    if (!trimmed || ask.isPending) return;
    setQuestion(trimmed);
    ask.mutate(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[14vh] translate-y-0 gap-0 p-0 sm:max-w-[620px]">
        <div className="flex items-center gap-2 px-4 pt-3.5 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-primary-text" />
          <DialogTitle className="text-xs font-medium text-soft">Ask about {project.name}</DialogTitle>
        </div>
        <DialogDescription className="sr-only">Ask a question; Claude answers from this project’s issues.</DialogDescription>
        <form
          className="flex items-end gap-2 px-4 pt-3 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            autoFocus
            rows={2}
            value={question}
            maxLength={500}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="What’s blocking the release? What did we finish last week?"
            aria-label="Question"
            className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
          />
          <Button type="submit" size="icon-sm" aria-label="Ask" disabled={!question.trim()} loading={ask.isPending}>
            <ArrowUp />
          </Button>
        </form>
        <div className="border-t px-4 py-3">
          {ask.isPending ? (
            <div className="flex flex-col gap-2" aria-label="Thinking">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : ask.isError ? (
            <p className="text-sm text-danger">{(ask.error as Error).message}</p>
          ) : ask.data ? (
            <div className={MARKDOWN_CLASS}>
              <ReactMarkdown
                components={{
                  a: ({ href, children }) =>
                    href?.startsWith("#issue-") ? (
                      <button
                        type="button"
                        className="font-mono text-[0.9em] text-primary-text underline"
                        onClick={() => {
                          onOpenChange(false);
                          onOpenIssue(href.slice("#issue-".length));
                        }}
                      >
                        {children}
                      </button>
                    ) : (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                }}
              >
                {linkKeys(ask.data.answer, project.key)}
              </ReactMarkdown>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => submit(example)}
                  className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
          <p className="mt-3 text-2xs text-muted-foreground">Answers come from this project’s issues and can be wrong.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
