"use client";

import { useMutation } from "@tanstack/react-query";
import { Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { useCanUseAi } from "@/components/ai/use-ai";
import { Button } from "@/components/ui/button";
import { summarizeWithAi } from "@/lib/api/ai";

/**
 * "Summarize" for a long discussion: a button for the Activity header and the
 * summary it shows. Read-only; nothing is saved.
 */
export function useIssueSummary(issueId: string, worthIt: boolean, markdownClass: string) {
  const canUseAi = useCanUseAi();
  const summarize = useMutation({
    mutationFn: () => summarizeWithAi(issueId),
    onError: (error: Error) => toast.error(error.message),
  });

  const trigger =
    canUseAi && worthIt && !summarize.data ? (
      <Button
        variant="ghost"
        size="xs"
        className="ml-auto text-muted-foreground"
        loading={summarize.isPending}
        loadingText="Summarizing…"
        onClick={() => summarize.mutate()}
      >
        <Sparkles />
        Summarize
      </Button>
    ) : null;

  const panel = summarize.data ? (
    <div className="relative rounded-lg border border-primary/30 bg-primary/5 p-3 pr-9">
      <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary-text">
        <Sparkles className="size-3.5" />
        Summary
      </p>
      <div className={markdownClass}>
        <ReactMarkdown>{summarize.data.summary}</ReactMarkdown>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Close summary"
        className="absolute top-2 right-2"
        onClick={() => summarize.reset()}
      >
        <X />
      </Button>
    </div>
  ) : null;

  return { trigger, panel };
}
