"use client";

import { CircleCheck, CircleDot, CircleX, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";

import type { PullRequestStub } from "@/lib/api/projects";
import { cn } from "@/lib/utils";

const CHECKS_LABEL: Record<PullRequestStub["checks"], string> = {
  NONE: "No checks",
  PENDING: "Checks running",
  PASS: "Checks passed",
  FAIL: "Checks failed",
};

export function ChecksIcon({ checks, className }: { checks: PullRequestStub["checks"]; className?: string }) {
  if (checks === "NONE") return null;
  const Icon = checks === "PASS" ? CircleCheck : checks === "FAIL" ? CircleX : CircleDot;
  return (
    <Icon
      aria-label={CHECKS_LABEL[checks]}
      className={cn(
        "size-3",
        checks === "PASS" && "text-success",
        checks === "FAIL" && "text-danger",
        checks === "PENDING" && "animate-pulse text-warning",
        className,
      )}
    />
  );
}

export function PullRequestIcon({ state, className }: { state: PullRequestStub["state"]; className?: string }) {
  const Icon = state === "MERGED" ? GitMerge : state === "CLOSED" ? GitPullRequestClosed : GitPullRequest;
  return (
    <Icon
      aria-hidden="true"
      className={cn(
        "size-3",
        state === "MERGED" && "text-primary",
        state === "OPEN" && "text-success",
        state === "CLOSED" && "text-muted-foreground",
        className,
      )}
    />
  );
}

/** The card's PR badge: the most relevant PR's state and checks. */
export function PullRequestBadge({ pullRequests }: { pullRequests: PullRequestStub[] }) {
  if (!pullRequests.length) return null;
  const pr = pullRequests.find((p) => p.state === "OPEN") ?? pullRequests.find((p) => p.state === "MERGED") ?? pullRequests[0]!;
  const title = `${pr.repoFullName}#${pr.number} · ${pr.state.toLowerCase()}${pr.state === "OPEN" ? ` · ${CHECKS_LABEL[pr.checks].toLowerCase()}` : ""}${pullRequests.length > 1 ? ` (+${pullRequests.length - 1} more)` : ""}`;
  return (
    <span
      title={title}
      className="inline-flex h-[18px] items-center gap-1 rounded-[5px] border px-1 text-2xs text-muted-foreground tabular"
    >
      <PullRequestIcon state={pr.state} />
      {pullRequests.length > 1 ? pullRequests.length : `#${pr.number}`}
      {pr.state === "OPEN" ? <ChecksIcon checks={pr.checks} /> : null}
    </span>
  );
}
