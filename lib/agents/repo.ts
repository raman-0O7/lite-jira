import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { GITHUB_WEB } from "@/lib/github/config";

export type IssueRepository = { fullName: string; url: string };

type Client = Prisma.TransactionClient | typeof db;

const toRepository = (fullName: string): IssueRepository => ({ fullName, url: `${GITHUB_WEB}/${fullName}` });

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
  if (issue.githubLink) return toRepository(issue.githubLink.repoFullName);
  return projectRepository(issue.projectId, client);
}

/** The project's first connected repo whose installation isn't suspended. */
export async function projectRepository(projectId: string, client: Client = db): Promise<IssueRepository | null> {
  const repo = await client.projectRepo.findFirst({
    where: { projectId, installation: { suspendedAt: null } },
    orderBy: { createdAt: "asc" },
    select: { repoFullName: true },
  });
  return repo ? toRepository(repo.repoFullName) : null;
}
