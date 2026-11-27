"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarked, Check, FileWarning, Pencil, X } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { toast } from "sonner";

import { GitHubMark } from "@/components/icons/GitHubMark";
import { useCan } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import {
  CONTEXT_KINDS,
  type ContextEntry,
  type ContextKind,
  contextKeys,
  decideContextEntry,
  ENTRY_MAX,
  fetchIssueProposals,
  fetchOverlaps,
  fetchProjectOverlaps,
  type Overlap,
  projectOverlapKeys,
} from "@/lib/api/project-context";
import { cn } from "@/lib/utils";

/**
 * Project context UI shared by the Context page, the issue panel and the board
 * (docs/features/27-project-context.md).
 */

export const kindLabel = (kind: ContextKind) => CONTEXT_KINDS.find((k) => k.id === kind)?.label ?? kind;

export function KindBadge({ kind }: { kind: ContextKind }) {
  return (
    <span className="inline-flex h-5 shrink-0 items-center rounded-[5px] bg-chip px-1.5 text-[11px] font-medium text-muted-foreground">
      {kindLabel(kind)}
    </span>
  );
}

/** Refresh every view that shows context entries. */
export function useRefreshContext() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["project-context"] });
    void queryClient.invalidateQueries({ queryKey: ["context-proposals"] });
  };
}

// ---------- Proposals ----------

/**
 * A proposal waiting for review: exactly the text agents would receive, its
 * source (flagged when it came from GitHub), and Accept / Edit / Reject.
 */
export function ProposalCard({
  entry,
  replaces,
  onOpenIssue,
}: {
  entry: ContextEntry;
  /** The text of the entry it would replace, when known. */
  replaces?: string | null;
  onOpenIssue?: (key: string) => void;
}) {
  const canDecide = useCan("context.write");
  const refresh = useRefreshContext();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(entry.text);
  const decide = useMutation({
    mutationFn: (input: { action: "accept" | "reject"; text?: string }) => decideContextEntry(entry.id, input),
    onSuccess: (_data, input) => {
      toast.success(input.action === "accept" ? "Added to the project context." : "Proposal rejected.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const pending = decide.isPending;

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-surface p-3 text-sm shadow-card">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <KindBadge kind={entry.kind} />
        <span>
          Proposed by <span className="font-medium text-foreground">{entry.proposedBy?.name ?? "someone"}</span>
          {entry.source ? (
            <>
              {" "}from{" "}
              {onOpenIssue ? (
                <button type="button" className="font-mono hover:text-foreground hover:underline" onClick={() => onOpenIssue(entry.source!.key)}>
                  {entry.source.key}
                </button>
              ) : (
                <span className="font-mono">{entry.source.key}</span>
              )}
            </>
          ) : null}
        </span>
      </div>
      {editing ? (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={ENTRY_MAX}
          rows={3}
          aria-label="Entry text"
          className="w-full resize-y rounded-md border bg-field px-2.5 py-2 text-sm outline-none focus:border-ring/60 focus:ring-3 focus:ring-ring/20"
        />
      ) : (
        <p className="whitespace-pre-wrap text-foreground">{entry.text}</p>
      )}
      {replaces ? (
        <p className="text-xs text-muted-foreground">
          Replaces: <span className="line-through">{replaces}</span>
        </p>
      ) : null}
      {entry.source?.fromGitHub ? (
        <p className="flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-foreground">
          <GitHubMark className="size-3.5 shrink-0 text-warning" />
          Its issue was imported from GitHub. Check the text says only what the team agreed: once accepted, every agent
          in this project reads it.
        </p>
      ) : null}
      {canDecide ? (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button size="sm" loading={pending} disabled={!text.trim()} onClick={() => decide.mutate({ action: "accept", text: text.trim() })}>
                <Check />
                Save and accept
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => (setEditing(false), setText(entry.text))}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" loading={pending} onClick={() => decide.mutate({ action: "accept" })}>
                <Check />
                Accept
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide.mutate({ action: "reject" })}>
                <X />
                Reject
              </Button>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Waiting for a member to review it.</p>
      )}
    </div>
  );
}

/** Proposals from an issue's runs, shown in its activity. */
export function IssueContextProposals({ issueId }: { issueId: string }) {
  const proposals = useQuery({ queryKey: contextKeys.proposals(issueId), queryFn: () => fetchIssueProposals(issueId) });
  const list = proposals.data?.proposals ?? [];
  if (!list.length) return null;
  return (
    <section aria-label="Context proposals" className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <BookMarked className="size-3.5 text-icon" />
        Proposed for the project context
      </h3>
      {list.map((entry) => (
        <ProposalCard key={entry.id} entry={entry} />
      ))}
    </section>
  );
}

// ---------- Overlaps ----------

const OverlapsContext = createContext<Record<string, Overlap[]>>({});

/** Loads a project's overlaps once for every card on the board or list. */
export function OverlapsProvider({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const query = useQuery({
    queryKey: projectOverlapKeys(projectId),
    queryFn: () => fetchProjectOverlaps(projectId),
    // Overlaps change as people push; a minute is fresh enough for a hint.
    refetchInterval: 60_000,
  });
  return <OverlapsContext.Provider value={query.data?.overlaps ?? {}}>{children}</OverlapsContext.Provider>;
}

export const useIssueOverlaps = (issueId: string) => useContext(OverlapsContext)[issueId] ?? [];

const overlapTitle = (overlaps: Overlap[]) =>
  overlaps
    .map((o) => `${o.key} (${o.agent ?? "a person"}) is changing ${o.files.slice(0, 5).join(", ")}${o.files.length > 5 ? ` and ${o.files.length - 5} more` : ""}`)
    .join("\n");

/** "Overlaps WEB-41" on a card. */
export function OverlapChip({ overlaps, className }: { overlaps: Overlap[]; className?: string }) {
  if (!overlaps.length) return null;
  const label = overlaps.length === 1 ? `Overlaps ${overlaps[0]!.key}` : `Overlaps ${overlaps.length} issues`;
  return (
    <span
      title={overlapTitle(overlaps)}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[5px] bg-warning/10 px-1.5 text-[11px] font-medium text-foreground",
        className,
      )}
    >
      <FileWarning className="size-3 text-warning" aria-hidden />
      {label}
    </span>
  );
}

/** The issue panel's overlap notice, with the shared files. */
export function IssueOverlaps({ issueId, onOpenIssue }: { issueId: string; onOpenIssue?: (key: string) => void }) {
  const query = useQuery({ queryKey: contextKeys.overlaps(issueId), queryFn: () => fetchOverlaps(issueId), refetchInterval: 60_000 });
  const overlaps = query.data?.overlaps ?? [];
  if (!overlaps.length) return null;
  return (
    <section aria-label="Overlapping work" className="flex flex-col gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <FileWarning className="size-3.5 text-warning" />
        Other work is changing the same files
      </h3>
      <ul className="flex flex-col gap-2">
        {overlaps.map((o) => (
          <li key={o.issueId} className="flex flex-col gap-1">
            <p className="text-xs">
              {onOpenIssue ? (
                <button type="button" className="font-mono font-medium hover:underline" onClick={() => onOpenIssue(o.key)}>
                  {o.key}
                </button>
              ) : (
                <span className="font-mono font-medium">{o.key}</span>
              )}{" "}
              <span className="text-muted-foreground">
                {o.title} · {o.agent ? `${o.agent} working` : "a person’s PR"}
                {o.pullRequest ? (
                  <>
                    {" · "}
                    <a href={o.pullRequest.url} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
                      #{o.pullRequest.number}
                    </a>
                  </>
                ) : null}
              </span>
            </p>
            <p className="font-mono text-[11px] break-all text-muted-foreground">
              {o.files.slice(0, 8).join(" · ")}
              {o.files.length > 8 ? ` · +${o.files.length - 8} more` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
