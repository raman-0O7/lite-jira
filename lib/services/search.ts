import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { issueQueryToWhere, parseIssueQuery, QueryError } from "@/lib/query/issue-query";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { badRequest } from "@/lib/services/errors";
import { cardSelect, toCard } from "@/lib/services/issue-shapes";
import { projectScope } from "@/lib/services/scope";

const LIMIT = 100;

/** A card plus its project and status, for lists that span projects. */
export const crossCardSelect = {
  ...cardSelect,
  updatedAt: true,
  column: { select: { name: true, category: true } },
  project: { select: { id: true, key: true, name: true } },
} satisfies Prisma.IssueSelect;

type CrossCardRow = Prisma.IssueGetPayload<{ select: typeof crossCardSelect }>;

export const toCrossCard = ({ project, ...issue }: CrossCardRow) => ({ ...toCard(project.key, issue), project });

/** Live issues in live projects the caller can see. */
export const visibleIssues = (ctx: Ctx): Prisma.IssueWhereInput => ({
  archivedAt: null,
  project: { ...projectScope(ctx), archivedAt: null },
});

/** Search the ctx workspace's issues with the query language; newest activity first. */
export async function searchIssues(ctx: Ctx, query: string, { limit = LIMIT } = {}) {
  authorize(ctx, "project.read");
  let filter;
  try {
    filter = issueQueryToWhere(parseIssueQuery(query), { userId: actingUserId(ctx) });
  } catch (error) {
    if (error instanceof QueryError) throw badRequest(error.message);
    throw error;
  }

  const issues = await db.issue.findMany({
    where: { AND: [visibleIssues(ctx), filter] },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: Math.min(Math.max(limit, 1), LIMIT),
    select: crossCardSelect,
  });
  return issues.map(toCrossCard);
}
