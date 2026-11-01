"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { IssueTypeIcon } from "@/components/icons/IssueTypeIcon";
import { PriorityIcon } from "@/components/icons/PriorityIcon";
import { StatusIcon } from "@/components/icons/StatusIcon";
import { AssigneeAvatars, cardRunStatus, RunStatusBadge } from "@/components/issue/AgentBadges";
import { BlockedChip } from "@/components/issue/BlockedChip";
import { DueDate } from "@/components/issue/DueDate";
import { LabelChip } from "@/components/issue/LabelChip";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { IssueSearchResult } from "@/lib/api/issues";
import { variantForCategory } from "@/lib/status";
import { cn } from "@/lib/utils";

export type RowSection = {
  id: string;
  title: string;
  hint?: string;
  issues: IssueSearchResult[];
  /** Starts collapsed (e.g. Done this week). */
  collapsed?: boolean;
};

/**
 * Issues from several projects, in sections, one dense row each (My Work, the
 * issues page). Rows open the issue page; `J` / `K` move and `Enter` opens.
 * Empty sections are hidden.
 */
export function IssueRows({ sections }: { sections: RowSection[] }) {
  const { slug } = useWorkspace();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(() => new Set(sections.filter((s) => s.collapsed).map((s) => s.id)));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLAnchorElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const shown = sections.filter((s) => s.issues.length > 0);
  const flat = shown.filter((s) => !collapsed.has(s.id)).flatMap((s) => s.issues);
  const href = (issue: IssueSearchResult) => `/${slug}/issues/${issue.key}`;

  function move(delta: number) {
    if (!flat.length) return;
    const index = flat.findIndex((i) => i.id === selectedId);
    const next = flat[index === -1 ? 0 : Math.min(Math.max(index + delta, 0), flat.length - 1)]!;
    setSelectedId(next.id);
    rowRefs.current.get(next.id)?.focus();
  }

  useHotkeys({
    j: () => move(1),
    k: () => move(-1),
    enter: (event) => {
      const target = event.target as Node;
      const issue = flat.find((i) => i.id === selectedId);
      if (!issue || (target !== document.body && !listRef.current?.contains(target))) return false;
      router.push(href(issue));
    },
  });

  return (
    <div ref={listRef} className="pb-6">
      {shown.map((section) => {
        const isCollapsed = collapsed.has(section.id);
        return (
          <section key={section.id} aria-label={section.title}>
            <button
              type="button"
              aria-expanded={!isCollapsed}
              onClick={() => {
                const next = new Set(collapsed);
                if (isCollapsed) next.delete(section.id);
                else next.add(section.id);
                setCollapsed(next);
              }}
              className="sticky top-0 z-10 flex h-9 w-full items-center gap-2 border-b bg-[color-mix(in_srgb,var(--background)_92%,var(--foreground))] px-4 text-left md:px-5"
            >
              <ChevronRight className={cn("size-3.5 text-icon transition-transform", !isCollapsed && "rotate-90")} />
              <h2 className="text-sm font-semibold text-foreground">{section.title}</h2>
              <span className="text-xs text-muted-foreground tabular">{section.issues.length}</span>
              {section.hint ? <span className="hidden truncate text-xs text-muted-foreground sm:inline">{section.hint}</span> : null}
            </button>
            {isCollapsed ? null : (
              <ul>
                {section.issues.map((issue) => {
                  const runStatus = cardRunStatus(issue.agentRuns);
                  return (
                    <li key={issue.id}>
                      <Link
                        href={href(issue)}
                        ref={(node) => {
                          if (node) rowRefs.current.set(issue.id, node);
                          else rowRefs.current.delete(issue.id);
                        }}
                        onFocus={() => setSelectedId(issue.id)}
                        aria-current={issue.id === selectedId ? "true" : undefined}
                        className={cn(
                          "flex h-9 w-full items-center gap-3 border-b px-4 text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent md:px-5",
                          issue.id === selectedId && "bg-accent/80",
                        )}
                      >
                        <PriorityIcon priority={issue.priority} />
                        <span className="w-[68px] shrink-0 truncate font-mono text-2xs text-muted-foreground">{issue.key}</span>
                        <StatusIcon variant={variantForCategory(issue.column.category)} label={issue.column.name} />
                        <IssueTypeIcon type={issue.type} />
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{issue.title}</span>
                        <BlockedChip blockedBy={issue.blockedBy} />
                        <span className="hidden max-w-[30%] shrink items-center gap-1 overflow-hidden lg:flex">
                          {issue.labels.map((label) => (
                            <LabelChip key={label.id} label={label} />
                          ))}
                        </span>
                        <span className="hidden max-w-32 truncate text-2xs text-muted-foreground md:inline" title={issue.project.name}>
                          {issue.project.name}
                        </span>
                        {issue.dueDate ? <DueDate value={issue.dueDate} className="hidden sm:inline-flex" /> : null}
                        {runStatus ? (
                          <RunStatusBadge
                            status={runStatus}
                            name={issue.assigneeAgent?.name}
                            kind={issue.assigneeAgent?.kind}
                            className="hidden sm:inline-flex"
                          />
                        ) : null}
                        <span className="flex min-w-5 shrink-0 justify-end">
                          <AssigneeAvatars person={issue.assignee} agent={issue.assigneeAgent} />
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
