import type { IssueLinkType, Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import type { Ctx } from "@/lib/services/context";
import { badRequest, notFound, ServiceError } from "@/lib/services/errors";
import { formatKey, parseKey } from "@/lib/services/issue-shapes";
import { projectScope } from "@/lib/services/scope";

/**
 * Issue links (docs/features/22-my-work.md "Issue links"). A link is stored
 * once (from → to); each side reads it its own way.
 */

export const LINK_RELATIONS = ["blocks", "blocked_by", "relates", "duplicates", "duplicated_by"] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

/** How a stored link reads from one side. */
const FROM: Record<IssueLinkType, LinkRelation> = { BLOCKS: "blocks", RELATES: "relates", DUPLICATES: "duplicates" };
const TO: Record<IssueLinkType, LinkRelation> = { BLOCKS: "blocked_by", RELATES: "relates", DUPLICATES: "duplicated_by" };

/** A relation as seen from `issue` → the stored type and direction. */
const STORED: Record<LinkRelation, { type: IssueLinkType; reversed: boolean }> = {
  blocks: { type: "BLOCKS", reversed: false },
  blocked_by: { type: "BLOCKS", reversed: true },
  relates: { type: "RELATES", reversed: false },
  duplicates: { type: "DUPLICATES", reversed: false },
  duplicated_by: { type: "DUPLICATES", reversed: true },
};

const linkedIssueSelect = {
  id: true,
  number: true,
  title: true,
  type: true,
  projectId: true,
  project: { select: { key: true } },
  column: { select: { name: true, category: true } },
} satisfies Prisma.IssueSelect;

type LinkedRow = Prisma.IssueGetPayload<{ select: typeof linkedIssueSelect }>;

const linkedIssue = (issue: LinkedRow) => ({
  id: issue.id,
  number: issue.number,
  title: issue.title,
  type: issue.type,
  column: issue.column,
  key: formatKey(issue.project.key, issue.number),
});

/** Blockers first, then how the rest read. */
const RANK: Record<LinkRelation, number> = { blocked_by: 0, blocks: 1, relates: 2, duplicates: 3, duplicated_by: 4 };

function findVisibleIssue(ctx: Ctx, issueId: string) {
  return db.issue.findFirst({ where: { id: issueId, project: projectScope(ctx) }, select: linkedIssueSelect });
}

/** The issue's links whose other issue the caller can see, blockers first. */
export async function listIssueLinks(ctx: Ctx, issueId: string) {
  authorize(ctx, "project.read");
  const issue = await findVisibleIssue(ctx, issueId);
  if (!issue) throw notFound("Issue not found");
  const visible = { project: projectScope(ctx), archivedAt: null };
  const [from, to] = await Promise.all([
    db.issueLink.findMany({
      where: { fromIssueId: issueId, toIssue: visible },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, toIssue: { select: linkedIssueSelect } },
    }),
    db.issueLink.findMany({
      where: { toIssueId: issueId, fromIssue: visible },
      orderBy: { createdAt: "asc" },
      select: { id: true, type: true, fromIssue: { select: linkedIssueSelect } },
    }),
  ]);
  return [
    ...from.map((link) => ({ id: link.id, relation: FROM[link.type], issue: linkedIssue(link.toIssue) })),
    ...to.map((link) => ({ id: link.id, relation: TO[link.type], issue: linkedIssue(link.fromIssue) })),
  ].sort((a, b) => RANK[a.relation] - RANK[b.relation]);
}

const addLinkSchema = z.object({
  relation: z.enum(LINK_RELATIONS),
  // The other issue, by key (WEB-42) or id.
  target: z.string().trim().min(1, "Choose an issue").max(100),
});

async function recordLink(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  action: "issue.linked" | "issue.unlinked",
  a: LinkedRow,
  b: LinkedRow,
  relation: LinkRelation,
) {
  const reverse = STORED[relation].reversed ? FROM[STORED[relation].type] : TO[STORED[relation].type];
  await recordActivity(tx, ctx, {
    action,
    projectId: a.projectId,
    issueId: a.id,
    data: { relation, key: formatKey(b.project.key, b.number), issueId: b.id },
  });
  await recordActivity(tx, ctx, {
    action,
    projectId: b.projectId,
    issueId: b.id,
    data: { relation: reverse, key: formatKey(a.project.key, a.number), issueId: a.id },
  });
}

/** Link `issueId` to another issue; `relation` reads from `issueId`. */
export async function addIssueLink(ctx: Ctx, issueId: string, input: unknown) {
  authorize(ctx, "issue.write");
  const { relation, target } = addLinkSchema.parse(input);
  const issue = await findVisibleIssue(ctx, issueId);
  if (!issue) throw notFound("Issue not found");
  const key = parseKey(target);
  const other = await db.issue.findFirst({
    where: {
      archivedAt: null,
      ...(key ? { number: key.number, project: { ...projectScope(ctx), key: key.projectKey } } : { id: target, project: projectScope(ctx) }),
    },
    select: linkedIssueSelect,
  });
  if (!other) throw notFound(`Issue ${target} not found`);
  if (other.id === issue.id) throw badRequest("An issue can't be linked to itself");

  const { type, reversed } = STORED[relation];
  const [fromIssueId, toIssueId] = reversed ? [other.id, issue.id] : [issue.id, other.id];
  const clash = await db.issueLink.findFirst({
    where: {
      type,
      OR: [
        { fromIssueId, toIssueId },
        // Relates is symmetric, and two issues can't block (or duplicate) each other.
        { fromIssueId: toIssueId, toIssueId: fromIssueId },
      ],
    },
    select: { fromIssueId: true },
  });
  if (clash) {
    const same = clash.fromIssueId === fromIssueId || type === "RELATES";
    throw new ServiceError(
      409,
      same
        ? `${formatKey(issue.project.key, issue.number)} is already linked to ${formatKey(other.project.key, other.number)} that way`
        : `${formatKey(other.project.key, other.number)} already ${FROM[type]} ${formatKey(issue.project.key, issue.number)}`,
    );
  }

  const link = await db.$transaction(async (tx) => {
    const created = await tx.issueLink.create({ data: { fromIssueId, toIssueId, type }, select: { id: true } });
    await recordLink(tx, ctx, "issue.linked", issue, other, relation);
    return created;
  });
  return { id: link.id, relation, issue: linkedIssue(other) };
}

/** Remove a link, from either side. */
export async function removeIssueLink(ctx: Ctx, issueId: string, linkId: string) {
  authorize(ctx, "issue.write");
  const issue = await findVisibleIssue(ctx, issueId);
  if (!issue) throw notFound("Issue not found");
  const link = await db.issueLink.findFirst({
    where: { id: linkId, OR: [{ fromIssueId: issueId }, { toIssueId: issueId }] },
    select: { id: true, type: true, fromIssueId: true, fromIssue: { select: linkedIssueSelect }, toIssue: { select: linkedIssueSelect } },
  });
  if (!link) throw notFound("Link not found");
  const fromHere = link.fromIssueId === issueId;
  const other = fromHere ? link.toIssue : link.fromIssue;
  await db.$transaction(async (tx) => {
    await tx.issueLink.delete({ where: { id: link.id } });
    await recordLink(tx, ctx, "issue.unlinked", issue, other, fromHere ? FROM[link.type] : TO[link.type]);
  });
  return { removed: true };
}
