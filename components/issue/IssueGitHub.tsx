"use client";

import { GitBranch } from "lucide-react";
import { toast } from "sonner";

import { GitHubMark } from "@/components/icons/GitHubMark";
import { ChecksIcon, PullRequestIcon } from "@/components/issue/GitHubBadges";
import type { IssueFull } from "@/lib/api/issues";
import { branchName } from "@/lib/github/branch";

const LINK = "min-w-0 truncate text-sm text-foreground hover:underline";

/** The GitHub block in the issue sidebar: linked issue, PRs, and branch name. */
export function IssueGitHub({ issue }: { issue: IssueFull }) {
  const branch = branchName(issue.key, issue.title);
  const prs = issue.pullRequests ?? [];

  async function copyBranch() {
    try {
      await navigator.clipboard.writeText(branch);
      toast.success("Branch name copied.");
    } catch {
      toast.error(branch);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5 border-t px-1 pt-3">
      <span className="px-1 text-xs text-muted-foreground">GitHub</span>
      {issue.githubLink ? (
        <a
          href={issue.githubLink.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
        >
          <GitHubMark className="size-3.5 shrink-0 text-icon" />
          <span className={LINK}>
            {issue.githubLink.repoFullName}#{issue.githubLink.number}
          </span>
          <span className="ml-auto shrink-0 text-2xs text-muted-foreground">
            {issue.githubLink.state === "OPEN" ? "Open" : "Closed"}
          </span>
        </a>
      ) : null}
      {prs.map((pr) => (
        <a
          key={pr.id}
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          title={`${pr.repoFullName}#${pr.number}: ${pr.title}`}
          className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-accent"
        >
          <PullRequestIcon state={pr.state} className="size-3.5 shrink-0" />
          <span className={LINK}>
            <span className="text-muted-foreground">#{pr.number}</span> {pr.title}
          </span>
          {pr.state === "OPEN" ? <ChecksIcon checks={pr.checks} className="ml-auto size-3.5 shrink-0" /> : null}
        </a>
      ))}
      <button
        type="button"
        onClick={copyBranch}
        title={branch}
        className="flex items-center gap-2 rounded-md px-1 py-1 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <GitBranch className="size-3.5 shrink-0" />
        <span className="truncate">Copy branch name</span>
      </button>
    </div>
  );
}
