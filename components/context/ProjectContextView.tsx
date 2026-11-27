"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, BookOpen, History, Pencil, Plus, Replace, Sparkles } from "lucide-react";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

import { useCanUseAi } from "@/components/ai/use-ai";
import { KindBadge, ProposalCard, useRefreshContext } from "@/components/context/ContextUI";
import { MARKDOWN_CLASS } from "@/components/issue/IssueActivity";
import { RowListSkeleton } from "@/components/loading/skeletons";
import { useCan } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  addContextEntry,
  BRIEF_MAX,
  CONTEXT_KINDS,
  type ContextEntry,
  type ContextKind,
  contextKeys,
  decideContextEntry,
  draftBriefWithAi,
  ENTRY_MAX,
  fetchBriefRevisions,
  fetchProjectContext,
  isLive,
  type ProjectContext,
  restoreBrief,
  saveBrief,
} from "@/lib/api/project-context";
import { cn } from "@/lib/utils";

/**
 * Project → Context (docs/features/27-project-context.md): the brief, entries
 * waiting for review, and accepted entries by kind. What's accepted here is
 * what every agent working on the project receives.
 */

const BRIEF_PLACEHOLDER = `## What this project is
A paragraph a new teammate (or agent) needs first.

## Architecture
How the pieces fit, in a few sentences.

## Things that must not break
- …

## Words we use
- “Account” means …`;

const fieldClass =
  "w-full resize-y rounded-md border bg-field px-3 py-2 text-sm outline-none focus:border-ring/60 focus:ring-3 focus:ring-ring/20";

const day = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

export function ProjectContextView({ projectId, onOpenIssue }: { projectId: string; onOpenIssue: (key: string) => void }) {
  const query = useQuery({ queryKey: contextKeys.project(projectId), queryFn: () => fetchProjectContext(projectId) });

  if (query.isPending) {
    return (
      <div className="mx-auto w-full max-w-3xl p-5">
        <RowListSkeleton label="Loading the project context" rows={4} />
      </div>
    );
  }
  if (query.isError) return <p className="p-8 text-center text-sm text-muted-foreground">{query.error.message}</p>;

  const context = query.data;
  const proposed = context.entries.filter((e) => e.status === "PROPOSED" && !e.archived);
  const byId = new Map(context.entries.map((e) => [e.id, e]));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-5 md:px-5">
        <header className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold text-foreground">
            <BookOpen className="size-4 text-icon" />
            Project context
          </h2>
          <p className="text-sm text-muted-foreground">
            What every agent and new teammate should know about {context.project.name}. Agents get it when they claim an
            issue, and any AI app can read it. Agents propose additions; nothing reaches them until a member accepts it.
          </p>
        </header>

        {proposed.length ? (
          <section aria-labelledby="waiting" className="flex flex-col gap-3">
            <h3 id="waiting" className="text-sm font-semibold text-foreground">
              Waiting for review <span className="ml-1 font-normal text-muted-foreground">{proposed.length}</span>
            </h3>
            {proposed.map((entry) => (
              <ProposalCard
                key={entry.id}
                entry={entry}
                replaces={entry.replacesId ? (byId.get(entry.replacesId)?.text ?? null) : null}
                onOpenIssue={onOpenIssue}
              />
            ))}
          </section>
        ) : null}

        <BriefSection projectId={projectId} context={context} />
        <EntriesSection projectId={projectId} entries={context.entries} onOpenIssue={onOpenIssue} />
      </div>
    </div>
  );
}

// ---------- Brief ----------

function BriefSection({ projectId, context }: { projectId: string; context: ProjectContext }) {
  const canEdit = useCan("context.write");
  const canUseAi = useCanUseAi();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const { brief } = context;

  const save = useMutation({
    mutationFn: (body: string) => saveBrief(projectId, body, brief.version),
    onSuccess: () => {
      toast.success("Brief saved.");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: contextKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: contextKeys.revisions(projectId) });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const aiDraft = useMutation({
    mutationFn: () => draftBriefWithAi(projectId),
    onSuccess: ({ brief: suggested }) => {
      setDraft(suggested);
      toast.success("Draft filled in. Review it, then save.");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <section aria-labelledby="brief" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="brief" className="mr-auto text-sm font-semibold text-foreground">
          Brief
        </h3>
        {brief.version > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
            <History />
            History
          </Button>
        ) : null}
        {canEdit && draft === null ? (
          <Button size="sm" variant="outline" onClick={() => setDraft(brief.body)}>
            <Pencil />
            {brief.body ? "Edit" : "Write the brief"}
          </Button>
        ) : null}
      </div>

      {draft !== null ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={BRIEF_PLACEHOLDER}
            maxLength={BRIEF_MAX}
            rows={16}
            aria-label="Brief"
            className={cn(fieldClass, "font-mono text-[13px]")}
          />
          <p className="text-xs text-muted-foreground">
            Markdown. Product decisions, constraints and vocabulary belong here; how to work in the code stays in the
            repository’s AGENTS.md or CLAUDE.md. {draft.length.toLocaleString()} / {BRIEF_MAX.toLocaleString()}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" loading={save.isPending} loadingText="Saving…" onClick={() => save.mutate(draft)}>
              Save
            </Button>
            <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => setDraft(null)}>
              Cancel
            </Button>
            {canUseAi ? (
              <Button
                size="sm"
                variant="ghost"
                className="ml-auto"
                loading={aiDraft.isPending}
                loadingText="Drafting…"
                onClick={() => aiDraft.mutate()}
              >
                <Sparkles />
                Draft from this project
              </Button>
            ) : null}
          </div>
        </div>
      ) : brief.body ? (
        <div className="rounded-lg border bg-surface p-4 shadow-card">
          <div className={MARKDOWN_CLASS}>
            <ReactMarkdown>{brief.body}</ReactMarkdown>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No brief yet. Write what this project is, how it’s built, what must not break, and the words the team uses.
        </p>
      )}

      <HistoryDialog projectId={projectId} open={historyOpen} onOpenChange={setHistoryOpen} canRestore={canEdit} current={brief.version} />
    </section>
  );
}

function HistoryDialog({
  projectId,
  open,
  onOpenChange,
  canRestore,
  current,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canRestore: boolean;
  current: number;
}) {
  const queryClient = useQueryClient();
  const revisions = useQuery({
    queryKey: contextKeys.revisions(projectId),
    queryFn: () => fetchBriefRevisions(projectId),
    enabled: open,
  });
  const [shown, setShown] = useState<number | null>(null);
  const restore = useMutation({
    mutationFn: (version: number) => restoreBrief(projectId, version),
    onSuccess: () => {
      toast.success("Restored as a new version.");
      void queryClient.invalidateQueries({ queryKey: contextKeys.project(projectId) });
      void queryClient.invalidateQueries({ queryKey: contextKeys.revisions(projectId) });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const list = revisions.data?.revisions ?? [];
  const selected = list.find((r) => r.version === shown) ?? list[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Brief history</DialogTitle>
          <DialogDescription>Every saved version. Restoring one saves it as a new version.</DialogDescription>
        </DialogHeader>
        {revisions.isPending ? (
          <RowListSkeleton label="Loading history" rows={3} />
        ) : (
          <div className="grid max-h-[60vh] gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
            <ul className="flex flex-col gap-1 overflow-y-auto">
              {list.map((r) => (
                <li key={r.version}>
                  <button
                    type="button"
                    onClick={() => setShown(r.version)}
                    className={cn(
                      "w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
                      selected?.version === r.version && "bg-accent",
                    )}
                  >
                    <span className="font-medium text-foreground">Version {r.version}</span>
                    {r.version === current ? <span className="text-muted-foreground"> · current</span> : null}
                    <span className="block text-muted-foreground">
                      {r.editedBy?.name ?? "Someone"} · {day(r.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {selected ? (
              <div className="flex min-w-0 flex-col gap-2">
                <pre className="max-h-[45vh] overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap">
                  {selected.body || "(empty)"}
                </pre>
                {canRestore && selected.version !== current ? (
                  <Button size="sm" variant="outline" className="self-start" loading={restore.isPending} onClick={() => restore.mutate(selected.version)}>
                    Restore version {selected.version}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------- Entries ----------

function EntriesSection({
  projectId,
  entries,
  onOpenIssue,
}: {
  projectId: string;
  entries: ContextEntry[];
  onOpenIssue: (key: string) => void;
}) {
  const canEdit = useCan("context.write");
  const [form, setForm] = useState<{ kind: ContextKind; replaces: ContextEntry | null } | null>(null);
  const live = entries.filter(isLive);
  const past = entries.filter((e) => e.status === "ACCEPTED" && !isLive(e));

  return (
    <section aria-labelledby="entries" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <h3 id="entries" className="mr-auto text-sm font-semibold text-foreground">
          Decisions, constraints, conventions and vocabulary
        </h3>
        {canEdit && !form ? (
          <Button size="sm" variant="outline" onClick={() => setForm({ kind: "DECISION", replaces: null })}>
            <Plus />
            Add
          </Button>
        ) : null}
      </div>

      {form ? <EntryForm projectId={projectId} initial={form} onDone={() => setForm(null)} /> : null}

      {live.length === 0 && !form ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Nothing yet. Add one fact per entry, with the reason when there is one: “Sessions stay cookie-based; no JWTs in
          the browser (security review, Oct).” Agents also propose entries as they finish work.
        </p>
      ) : null}

      {CONTEXT_KINDS.map(({ id, plural }) => {
        const list = live.filter((e) => e.kind === id);
        if (!list.length) return null;
        return (
          <div key={id} className="flex flex-col gap-1.5">
            <h4 className="text-xs font-medium text-muted-foreground">{plural}</h4>
            <ul className="divide-y rounded-lg border bg-surface shadow-card">
              {list.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  canEdit={canEdit}
                  onOpenIssue={onOpenIssue}
                  onReplace={() => setForm({ kind: entry.kind, replaces: entry })}
                />
              ))}
            </ul>
          </div>
        );
      })}

      {past.length ? (
        <details className="group text-sm">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            Replaced and archived ({past.length})
          </summary>
          <ul className="mt-2 divide-y rounded-lg border bg-surface/60">
            {past.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-1 px-3 py-2 text-muted-foreground">
                <span className="flex items-center gap-2">
                  <KindBadge kind={entry.kind} />
                  <span className="text-xs">{entry.replacedById ? "Replaced" : "Archived"}</span>
                </span>
                <span className="line-through">{entry.text}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function EntryRow({
  entry,
  canEdit,
  onOpenIssue,
  onReplace,
}: {
  entry: ContextEntry;
  canEdit: boolean;
  onOpenIssue: (key: string) => void;
  onReplace: () => void;
}) {
  const refresh = useRefreshContext();
  const archive = useMutation({
    mutationFn: () => decideContextEntry(entry.id, { action: "archive" }),
    onSuccess: () => {
      toast.success("Archived. Agents no longer get it.");
      refresh();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <li className="group flex items-start gap-3 px-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm whitespace-pre-wrap text-foreground">{entry.text}</p>
        <p className="text-xs text-muted-foreground">
          {entry.source ? (
            <>
              <button type="button" className="font-mono hover:text-foreground hover:underline" onClick={() => onOpenIssue(entry.source!.key)}>
                {entry.source.key}
              </button>
              {" · "}
            </>
          ) : null}
          {entry.sourcePrUrl ? (
            <>
              <a href={entry.sourcePrUrl} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
                PR
              </a>
              {" · "}
            </>
          ) : null}
          {entry.proposedBy?.type === "agent" ? `Proposed by ${entry.proposedBy.name}, accepted` : "Added"} by{" "}
          {entry.decidedBy?.name ?? "someone"} · {day(entry.decidedAt ?? entry.createdAt)}
        </p>
      </div>
      {canEdit ? (
        <div className="flex shrink-0 gap-1 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          <Button size="icon-sm" variant="ghost" aria-label="Replace with a newer entry" title="Replace" onClick={onReplace}>
            <Replace />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Archive" title="Archive" disabled={archive.isPending} onClick={() => archive.mutate()}>
            <Archive />
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function EntryForm({
  projectId,
  initial,
  onDone,
}: {
  projectId: string;
  initial: { kind: ContextKind; replaces: ContextEntry | null };
  onDone: () => void;
}) {
  const refresh = useRefreshContext();
  const [kind, setKind] = useState<ContextKind>(initial.kind);
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => addContextEntry(projectId, { kind, text: text.trim(), replacesId: initial.replaces?.id }),
    onSuccess: () => {
      toast.success(initial.replaces ? "Replaced. Agents get the new entry." : "Added. Agents get it from now on.");
      refresh();
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border bg-surface p-3 shadow-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) add.mutate();
      }}
    >
      {initial.replaces ? (
        <p className="text-xs text-muted-foreground">
          Replacing: <span className="line-through">{initial.replaces.text}</span>
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <Select value={kind} onValueChange={(value) => setKind(value as ContextKind)} disabled={Boolean(initial.replaces)}>
          <SelectTrigger className="sm:w-40" aria-label="Kind">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONTEXT_KINDS.map((k) => (
              <SelectItem key={k.id} value={k.id}>
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={ENTRY_MAX}
          rows={2}
          autoFocus
          placeholder="One fact, with the reason when there is one"
          aria-label="Entry"
          className={fieldClass}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={add.isPending} disabled={!text.trim()}>
          {initial.replaces ? "Replace" : "Add"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={add.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
