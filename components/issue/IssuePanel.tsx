"use client";

import { useQuery } from "@tanstack/react-query";
import { Link2, Maximize2, X } from "lucide-react";
import Link from "next/link";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { IssueDetail } from "@/components/issue/IssueDetail";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { isTypingTarget } from "@/hooks/use-hotkeys";
import { fetchIssue, issueKeys } from "@/lib/api/issues";

/** Copy an issue's page URL to the clipboard. */
export async function copyIssueLink(slug: string, key: string) {
  try {
    await navigator.clipboard.writeText(`${window.location.origin}/${slug}/issues/${key}`);
    toast.success("Link copied.");
  } catch {
    toast.error("Couldn’t copy the link.");
  }
}

/**
 * The issue side panel over a project view. `Esc` closes it (unless a field
 * has focus); "Open as page" goes to /[workspace]/issues/[key].
 */
export function IssuePanel({
  projectId,
  issueId,
  onClose,
  onNavigate,
  onDeleted,
}: {
  projectId: string;
  /** The open issue, or null when the panel is closed. */
  issueId: string | null;
  onClose: () => void;
  onNavigate: (key: string) => void;
  onDeleted: (issueId: string) => void;
}) {
  const { slug } = useWorkspace();
  // Keep showing the last issue while the panel animates closed.
  const [shownId, setShownId] = useState(issueId);
  if (issueId && issueId !== shownId) setShownId(issueId);

  const issueQuery = useQuery({
    queryKey: issueKeys.detail(shownId ?? ""),
    queryFn: () => fetchIssue(shownId!),
    enabled: shownId !== null,
  });
  const issue = issueQuery.data;

  return (
    <DialogPrimitive.Root open={issueId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/10 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 dark:bg-black/30" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Focus the panel itself rather than its first button (no stray focus ring).
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.target as HTMLElement | null)?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // Esc in a field cancels the edit, not the panel.
            if (isTypingTarget(event.target)) event.preventDefault();
          }}
          className="fixed inset-y-0 right-0 z-40 flex w-full flex-col overflow-hidden bg-background shadow-popover outline-none duration-150 data-open:animate-in data-open:slide-in-from-right-8 data-open:fade-in-0 data-closed:animate-out data-closed:slide-out-to-right-8 data-closed:fade-out-0 sm:inset-y-2 sm:right-2 sm:w-[min(980px,calc(100vw-96px))] sm:rounded-xl sm:border"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b pr-2 pl-5">
            <DialogPrimitive.Title className="min-w-0 truncate text-xs text-muted-foreground">
              {issue ? (
                <>
                  {issue.project.name} <span aria-hidden="true">/</span>{" "}
                  <span className="font-mono text-soft">{issue.key}</span>
                  <span className="sr-only">: {issue.title}</span>
                </>
              ) : (
                "Issue"
              )}
            </DialogPrimitive.Title>
            <div className="ml-auto flex items-center gap-0.5">
              {issue ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label="Copy link"
                    title="Copy link"
                    onClick={() => copyIssueLink(slug, issue.key)}
                  >
                    <Link2 />
                  </Button>
                  <Button
                    asChild
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground"
                    aria-label="Open as page"
                    title="Open as page"
                  >
                    <Link href={`/${slug}/issues/${issue.key}`}>
                      <Maximize2 />
                    </Link>
                  </Button>
                </>
              ) : null}
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label="Close" title="Close (Esc)">
                  <X />
                </Button>
              </DialogPrimitive.Close>
            </div>
          </div>
          {shownId ? (
            <IssueDetail
              key={shownId}
              issueId={shownId}
              projectId={projectId}
              onNavigate={onNavigate}
              onDelete={() => onDeleted(shownId)}
            />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
