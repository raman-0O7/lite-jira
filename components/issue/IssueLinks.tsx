"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { StatusIcon } from "@/components/icons/StatusIcon";
import { InlineLoading } from "@/components/loading/skeletons";
import { useCan, useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { issueKeys, searchIssues, type IssueFull } from "@/lib/api/issues";
import { projectKeys } from "@/lib/api/projects";
import {
  addIssueLink,
  fetchIssueLinks,
  type IssueLink,
  type LinkRelation,
  RELATION_LABEL,
  removeIssueLink,
  workKeys,
} from "@/lib/api/work";
import { variantForCategory } from "@/lib/status";
import { cn } from "@/lib/utils";

const RELATIONS: LinkRelation[] = ["blocks", "blocked_by", "relates", "duplicates", "duplicated_by"];

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Links to other issues (docs/features/22-my-work.md §3), grouped by relation.
 * Hidden for viewers when there are none.
 */
export function IssueLinks({ issue, onOpen }: { issue: IssueFull; onOpen: (key: string) => void }) {
  const queryClient = useQueryClient();
  const canEdit = useCan("issue.write");
  const links = useQuery({ queryKey: workKeys.links(issue.id), queryFn: () => fetchIssueLinks(issue.id) });

  // A link changes "Blocked" on both issues' cards and pages, and both timelines.
  const refresh = (other?: IssueLink["issue"]) => {
    queryClient.invalidateQueries({ queryKey: workKeys.links(issue.id) });
    queryClient.invalidateQueries({ queryKey: issueKeys.detail(issue.id) });
    queryClient.invalidateQueries({ queryKey: projectKeys.detail(issue.projectId) });
    queryClient.invalidateQueries({ queryKey: ["issue-search"] });
    queryClient.invalidateQueries({ queryKey: ["my-work"] });
    if (other) {
      queryClient.invalidateQueries({ queryKey: workKeys.links(other.id) });
      queryClient.invalidateQueries({ queryKey: issueKeys.detail(other.id) });
    }
  };

  const remove = useMutation({
    mutationFn: (link: IssueLink) => removeIssueLink(issue.id, link.id),
    onSuccess: (_, link) => refresh(link.issue),
    onError: (error: Error) => toast.error(error.message),
  });

  const rows = links.data ?? [];
  if (!canEdit && rows.length === 0) return null;
  const groups = RELATIONS.map((relation) => ({ relation, links: rows.filter((l) => l.relation === relation) })).filter(
    (g) => g.links.length > 0,
  );

  return (
    <section aria-label="Linked issues" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h2 className="font-heading text-sm font-semibold text-foreground">Linked issues</h2>
        {rows.length > 0 ? <span className="text-xs text-muted-foreground tabular">{rows.length}</span> : null}
        {canEdit ? <LinkIssuePicker issue={issue} onLinked={refresh} /> : null}
      </div>
      {links.isPending ? (
        <InlineLoading label="Loading links…" className="py-1" />
      ) : groups.length > 0 ? (
        <div className="flex flex-col overflow-hidden rounded-lg border">
          {groups.map((group) => (
            <div key={group.relation} className="border-b last:border-b-0">
              <h3 className="px-3 pt-2 pb-1 text-2xs font-medium text-muted-foreground">{RELATION_LABEL[group.relation]}</h3>
              <ul>
                {group.links.map((link) => {
                  const done = link.issue.column.category === "DONE";
                  return (
                    <li key={link.id} className="group flex h-9 items-center hover:bg-accent/60">
                      <button
                        type="button"
                        onClick={() => onOpen(link.issue.key)}
                        className="flex h-full min-w-0 flex-1 items-center gap-2.5 px-3 text-left text-sm"
                      >
                        <StatusIcon variant={variantForCategory(link.issue.column.category)} label={link.issue.column.name} />
                        <IssueTypeIcon type={link.issue.type} />
                        <span className="shrink-0 font-mono text-2xs text-muted-foreground">{link.issue.key}</span>
                        <span className={cn("min-w-0 flex-1 truncate", done ? "text-muted-foreground line-through" : "text-foreground")}>
                          {link.issue.title}
                        </span>
                      </button>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => remove.mutate(link)}
                          disabled={remove.isPending && remove.variables?.id === link.id}
                          aria-label={`Remove link to ${link.issue.key}`}
                          title="Remove link"
                          className="mr-1.5 flex size-6 shrink-0 items-center justify-center rounded text-icon opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                        >
                          {remove.isPending && remove.variables?.id === link.id ? <Spinner className="size-3" /> : <X className="size-3.5" />}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Nothing linked. Mark what blocks this, or what it duplicates.</p>
      )}
    </section>
  );
}

/** "Link issue": pick a relation, then an issue by key or title. */
function LinkIssuePicker({ issue, onLinked }: { issue: IssueFull; onLinked: (other: IssueLink["issue"]) => void }) {
  const { slug } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [relation, setRelation] = useState<LinkRelation>("blocked_by");
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const debounced = useDebounced(trimmed, 150);
  const results = useQuery({
    queryKey: ["issue-search", slug, debounced, "link"],
    queryFn: () => searchIssues(slug, debounced),
    enabled: open && debounced.length > 0,
  });
  const candidates = (results.data ?? []).filter((i) => i.id !== issue.id).slice(0, 8);

  const add = useMutation({
    mutationFn: (target: string) => addIssueLink(issue.id, { relation, target }),
    onSuccess: (link) => {
      onLinked(link.issue);
      setText("");
      setOpen(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground">
          <Plus /> Link issue
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-2 p-2">
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const pick = candidates[0]?.key ?? trimmed;
            if (pick) add.mutate(pick);
          }}
        >
          <div className="flex items-center gap-2">
            <span className="shrink-0 font-mono text-2xs text-muted-foreground">{issue.key}</span>
            <Select value={relation} onValueChange={(value) => setRelation(value as LinkRelation)}>
              <SelectTrigger size="sm" className="flex-1" aria-label="Relation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RELATIONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {RELATION_LABEL[r].toLowerCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex h-8 items-center gap-2 rounded-md border bg-field px-2">
            <Link2 className="size-3.5 shrink-0 text-icon" />
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Issue key or title…"
              aria-label="Issue to link"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {add.isPending || (results.isFetching && debounced) ? <Spinner className="size-3" /> : null}
          </div>
        </form>
        {debounced ? (
          <ul className="flex max-h-64 flex-col overflow-y-auto">
            {candidates.map((candidate) => (
              <li key={candidate.id}>
                <button
                  type="button"
                  disabled={add.isPending}
                  onClick={() => add.mutate(candidate.key)}
                  className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-accent"
                >
                  <StatusIcon variant={variantForCategory(candidate.column.category)} label={candidate.column.name} />
                  <span className="shrink-0 font-mono text-2xs text-muted-foreground">{candidate.key}</span>
                  <span className="min-w-0 flex-1 truncate">{candidate.title}</span>
                </button>
              </li>
            ))}
            {results.isSuccess && candidates.length === 0 ? (
              <li className="px-2 py-1.5 text-xs text-muted-foreground">No matching issues</li>
            ) : null}
            {results.isError ? <li className="px-2 py-1.5 text-xs text-destructive">{results.error.message}</li> : null}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
