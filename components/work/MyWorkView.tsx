"use client";

import { useQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader, PageTitle } from "@/components/app-shell/PageHeader";
import { IssueRowsSkeleton } from "@/components/loading/skeletons";
import { useWorkspace } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { IssueRows, type RowSection } from "@/components/work/IssueRows";
import { fetchMyWork, workKeys } from "@/lib/api/work";
import { cn } from "@/lib/utils";

type Tab = "assigned" | "created";

/** My Work (docs/features/22-my-work.md §1): your issues across projects. */
export function MyWorkView() {
  const { slug } = useWorkspace();
  const [tab, setTab] = useState<Tab>("assigned");
  const work = useQuery({ queryKey: workKeys.myWork(slug), queryFn: () => fetchMyWork(slug) });

  const sections: RowSection[] = work.data
    ? tab === "assigned"
      ? [
          {
            id: "needs-you",
            title: "Needs you",
            hint: "Your agent is waiting for an answer, or a pull request is ready to review",
            issues: work.data.needsYou,
          },
          { id: "in-progress", title: "In progress", issues: work.data.inProgress },
          { id: "todo", title: "To do", issues: work.data.todo },
          { id: "done", title: "Done this week", issues: work.data.doneThisWeek, collapsed: true },
        ]
      : [{ id: "created", title: "Created by me", hint: "Open issues you reported", issues: work.data.created }]
    : [];
  const empty = work.data && sections.every((s) => s.issues.length === 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader>
        <PageTitle>My work</PageTitle>
        <div role="tablist" aria-label="Show" className="ml-1 flex h-7 shrink-0 items-center rounded-md bg-chip p-0.5">
          {(
            [
              { id: "assigned", label: "Assigned to me" },
              { id: "created", label: "Created by me" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "flex h-6 items-center rounded-[5px] px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                tab === id && "bg-seg text-foreground shadow-seg",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </PageHeader>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {work.isPending ? (
          <IssueRowsSkeleton label="Loading your work" />
        ) : work.isError ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">{work.error.message}</p>
        ) : empty ? (
          <div className="mx-auto flex max-w-sm flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-primary-soft">
              <Inbox className="size-5 text-primary-text" />
            </span>
            <p className="text-sm font-medium">{tab === "assigned" ? "Nothing on your plate" : "No open issues you reported"}</p>
            <p className="text-sm text-muted-foreground">
              {tab === "assigned"
                ? "Issues assigned to you, in any project, show up here. So do your agents’ questions."
                : "Issues you create show up here until they’re done."}
            </p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/${slug}/projects`}>Go to projects</Link>
            </Button>
          </div>
        ) : (
          <IssueRows key={tab} sections={sections} />
        )}
      </div>
    </div>
  );
}
