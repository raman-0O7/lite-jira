import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { GITHUB_WEB } from "@/lib/github/config";

export type IssueRepository = { fullName: string; url: string; baseBranch: string | null };

type Client = Prisma.TransactionClient | typeof db;

const toRepository = (fullName: string, baseBranch: string | null = null): IssueRepository => ({
  fullName,
  url: `${GITHUB_WEB}/${fullName}`,
  baseBranch,
});

/**
 * The GitHub repository an agent works in for an issue: the repo the issue
 * was imported from, else the project's first connected repo. Null when the
 * project has none (docs/features/15-github-setup.md "Which repository").
 */
export async function issueRepository(issueId: string, client: Client = db): Promise<IssueRepository | null> {
  const issue = await client.issue.findUnique({
    where: { id: issueId },
    select: { projectId: true, githubLink: { select: { repoFullName: true } } },
  });
  if (!issue) return null;
  if (issue.githubLink) {
    const repo = await client.projectRepo.findFirst({
      where: { repoFullName: issue.githubLink.repoFullName, projectId: issue.projectId },
      select: { baseBranch: true },
    });
    return toRepository(issue.githubLink.repoFullName, repo?.baseBranch ?? null);
  }
  return projectRepository(issue.projectId, client);
}

/** The project's first connected repo whose installation isn't suspended. */
export async function projectRepository(projectId: string, client: Client = db): Promise<IssueRepository | null> {
  const repo = await client.projectRepo.findFirst({
    where: { projectId, installation: { suspendedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { repoFullName: true, baseBranch: true },
  });
  return repo ? toRepository(repo.repoFullName, repo.baseBranch) : null;
}
