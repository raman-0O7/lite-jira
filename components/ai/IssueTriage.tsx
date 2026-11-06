"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCanUseAi } from "@/components/ai/use-ai";
import { GitHubMark } from "@/components/icons/GitHubMark";
import { useCan } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { triageWithAi } from "@/lib/api/ai";
import type { IssueFull, UpdateIssuePayload } from "@/lib/api/issues";
import { fetchProjectLabels, labelKeys, type LabelStub } from "@/lib/api/labels";
import type { IssueCard } from "@/lib/api/projects";
import { ISSUE_TYPE_LABEL, PRIORITY_LABEL } from "@/lib/task-meta";
import { cn } from "@/lib/utils";

type Change = { field: "type" | "priority" | "labels" | "estimate"; label: string; from: string; to: string; picked: boolean };

/**
 * "Triage" on an issue imported from GitHub: AI suggests its type, priority,
 * labels and estimate; the person picks which to apply, as their own edit.
 */
export function IssueTriage({
  issue,
  onApply,
}: {
  issue: IssueFull;
  onApply: (payload: UpdateIssuePayload, card: Partial<IssueCard>) => void;
}) {
  const canUseAi = useCanUseAi();
  const canEdit = useCan("issue.write");
  const shown = canUseAi && canEdit && issue.source === "GITHUB";
  const labelsQuery = useQuery({
    queryKey: labelKeys.project(issue.projectId),
    queryFn: () => fetchProjectLabels(issue.projectId),
    enabled: shown,
  });
  const [changes, setChanges] = useState<Change[] | null>(null);
  const [suggestion, setSuggestion] = useState<{ labels: LabelStub[]; reason: string } | null>(null);

  const triage = useMutation({
    mutationFn: () => triageWithAi(issue.id),
    onSuccess: (s) => {
      const known = labelsQuery.data ?? [];
      const current = new Set(issue.labels.map((l) => l.id));
      const added = s.labelIds
        .filter((id) => !current.has(id))
        .map((id) => known.find((l) => l.id === id))
        .filter((l): l is LabelStub => Boolean(l));
      const next: Change[] = [];
      if (s.type && s.type !== issue.type) {
        next.push({ field: "type", label: "Type", from: ISSUE_TYPE_LABEL[issue.type], to: ISSUE_TYPE_LABEL[s.type], picked: true });
      }
      if (s.priority !== issue.priority) {
        next.push({ field: "priority", label: "Priority", from: PRIORITY_LABEL[issue.priority], to: PRIORITY_LABEL[s.priority], picked: true });
      }
      if (added.length) {
        next.push({ field: "labels", label: "Labels", from: "", to: `+ ${added.map((l) => l.name).join(", ")}`, picked: true });
      }
      if (s.estimate != null && s.estimate !== issue.estimate) {
        const from = issue.estimate == null ? "—" : String(issue.estimate);
        next.push({ field: "estimate", label: "Estimate", from, to: String(s.estimate), picked: true });
      }
      if (!next.length) {
        toast("Nothing to change: this issue already looks triaged.");
        return;
      }
      setChanges(next);
      setSuggestion({ labels: added, reason: s.reason });
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const result = triage.data;

  if (!shown) return null;

  function apply() {
    if (!changes || !result) return;
    const picked = new Set(changes.filter((c) => c.picked).map((c) => c.field));
    const payload: UpdateIssuePayload = {};
    const card: Partial<IssueCard> = {};
    if (picked.has("type") && result.type) payload.type = card.type = result.type;
    if (picked.has("priority")) payload.priority = card.priority = result.priority;
    if (picked.has("estimate")) payload.estimate = card.estimate = result.estimate;
    if (picked.has("labels") && suggestion) {
      card.labels = [...issue.labels, ...suggestion.labels];
      payload.labelIds = card.labels.map((l) => l.id);
    }
    onApply(payload, card);
    setChanges(null);
    toast.success("Triage applied.");
  }

  if (!changes) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <GitHubMark className="size-3.5 text-icon" />
        Imported from GitHub
        <Button variant="ghost" size="xs" loading={triage.isPending} loadingText="Triaging…" onClick={() => triage.mutate()}>
          <Sparkles />
          Triage
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-primary-text">
        <Sparkles className="size-3.5" />
        Suggested triage
      </p>
      <ul className="flex flex-col gap-1">
        {changes.map((c, index) => (
          <li key={c.field}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-accent/60">
              <input
                type="checkbox"
                checked={c.picked}
                onChange={() => setChanges(changes.map((x, i) => (i === index ? { ...x, picked: !x.picked } : x)))}
                className="accent-primary"
              />
              <span className="w-16 shrink-0 text-muted-foreground">{c.label}</span>
              <span className={cn("min-w-0 truncate", c.picked ? "text-foreground" : "text-muted-foreground line-through")}>
                {c.from ? <span className="text-muted-foreground">{c.from} → </span> : null}
                {c.to}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {suggestion?.reason ? <p className="text-xs text-muted-foreground">{suggestion.reason}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setChanges(null)}>
          Dismiss
        </Button>
        <Button size="sm" disabled={!changes.some((c) => c.picked)} onClick={apply}>
          Apply
        </Button>
      </div>
    </div>
  );
}
