import type { ActorType, ColumnCategory, Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { Ctx } from "@/lib/services/context";
import { notFound } from "@/lib/services/errors";
import { projectScope } from "@/lib/services/scope";

export type ActivityAction =
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "column.created"
  | "column.updated"
  | "column.deleted"
  | "column.reordered"
  | "issue.created"
  | "issue.updated"
  | "issue.moved"
  | "issue.deleted"
  | "label.created"
  | "label.updated"
  | "label.deleted"
  | "comment.added"
  | "comment.edited"
  | "comment.deleted"
  | "workspace.created"
  | "workspace.updated"
  | "invite.created"
  | "invite.revoked"
  | "invite.renewed"
  | "member.joined"
  | "member.role_changed"
  | "member.removed"
  | "member.left"
  | "member.projects_changed"
  | "api_token.created"
  | "api_token.revoked"
  | "github.installed"
  | "github.uninstalled"
  | "github.repo_connected"
  | "github.repo_updated"
  | "github.repo_disconnected";

type ActivityEntry = {
  action: ActivityAction;
  projectId?: string;
  issueId?: string;
  data?: Prisma.InputJsonObject;
};

const ACTOR_TYPE: Record<Ctx["actor"]["type"], ActorType> = {
  user: "USER",
  agent: "AGENT",
  github: "GITHUB",
  system: "SYSTEM",
};

/**
 * Append an activity row. Must be called with the same transaction client as
 * the write it describes, so history and data can never disagree.
 *
 * Agents record both themselves (`actorAgentId`) and the user they act for
 * (`actorUserId`), so "Claude, on behalf of Raman" is reconstructable.
 */
export async function recordActivity(
  tx: Prisma.TransactionClient,
  ctx: Ctx,
  entry: ActivityEntry,
) {
  const { actor } = ctx;
  await tx.activity.create({
    data: {
      workspaceId: ctx.workspaceId,
      projectId: entry.projectId,
      issueId: entry.issueId,
      action: entry.action,
      data: { ...entry.data, via: ctx.via },
      actorType: ACTOR_TYPE[actor.type],
      actorUserId:
        actor.type === "user"
          ? actor.userId
          : actor.type === "agent"
            ? actor.onBehalfOf
            : null,
      actorAgentId: actor.type === "agent" ? actor.agentId : null,
    },
  });
}

// ---------- Issue timeline ----------

/** The actions an issue's timeline shows; comments render from their own rows. */
const ISSUE_TIMELINE_ACTIONS = ["issue.created", "issue.updated", "issue.moved"];

type Person = { id: string; name: string; image: string | null };

export type IssueActivityRefs = {
  people: Record<string, Person>;
  columns: Record<string, { id: string; name: string; category: ColumnCategory }>;
  labels: Record<string, { id: string; name: string; color: string }>;
  issues: Record<string, { id: string; key: string; title: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(...values: unknown[]): string[] {
  return values.flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? strings(...v) : []));
}

/**
 * An issue's history, oldest first, with the people, columns, labels, and
 * issues it mentions resolved to names. Same visibility as the issue itself:
 * a guest sees it only on a shared project (otherwise "not found").
 */
export async function listIssueActivity(ctx: Ctx, issueId: string) {
  authorize(ctx, "project.read");
  const issue = await db.issue.findFirst({
    where: { id: issueId, project: projectScope(ctx) },
    select: { id: true, projectId: true, project: { select: { key: true } } },
  });
  if (!issue) throw notFound("Issue not found");

  const rows = await db.activity.findMany({
    where: { issueId, workspaceId: ctx.workspaceId, action: { in: ISSUE_TIMELINE_ACTIONS } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      action: true,
      actorType: true,
      actorAgentId: true,
      actorUserId: true,
      data: true,
      createdAt: true,
    },
  });

  // Collect every id the rows refer to, by kind.
  const people = new Set<string>();
  const columns = new Set<string>();
  const labels = new Set<string>();
  const issues = new Set<string>();
  for (const row of rows) {
    if (row.actorUserId) people.add(row.actorUserId);
    const data = isRecord(row.data) ? row.data : {};
    strings(data.assigneeUserId).forEach((id) => people.add(id));
    strings(data.columnId, data.fromColumnId, data.toColumnId).forEach((id) => columns.add(id));
    strings(data.parentId).forEach((id) => issues.add(id));
    const changes = isRecord(data.changes) ? data.changes : {};
    for (const [field, value] of Object.entries(changes)) {
      if (!isRecord(value)) continue;
      if (field === "assigneeUserId") strings(value.from, value.to).forEach((id) => people.add(id));
      if (field === "epicId") strings(value.from, value.to).forEach((id) => issues.add(id));
      if (field === "labels") strings(value.added, value.removed).forEach((id) => labels.add(id));
    }
  }

  const [personRows, columnRows, labelRows, issueRows] = await Promise.all([
    people.size
      ? db.user.findMany({ where: { id: { in: [...people] } }, select: { id: true, name: true, image: true } })
      : [],
    columns.size
      ? db.column.findMany({
          where: { id: { in: [...columns] }, projectId: issue.projectId },
          select: { id: true, name: true, category: true },
        })
      : [],
    labels.size
      ? db.label.findMany({
          where: { id: { in: [...labels] }, projectId: issue.projectId },
          select: { id: true, name: true, color: true },
        })
      : [],
    issues.size
      ? db.issue.findMany({
          where: { id: { in: [...issues] }, projectId: issue.projectId },
          select: { id: true, number: true, title: true },
        })
      : [],
  ]);

  const refs: IssueActivityRefs = {
    people: Object.fromEntries(personRows.map((p) => [p.id, p])),
    columns: Object.fromEntries(columnRows.map((c) => [c.id, c])),
    labels: Object.fromEntries(labelRows.map((l) => [l.id, l])),
    issues: Object.fromEntries(
      issueRows.map((i) => [i.id, { id: i.id, key: `${issue.project.key}-${i.number}`, title: i.title }]),
    ),
  };

  const entries = rows.map((row) => ({
    id: row.id,
    action: row.action,
    createdAt: row.createdAt,
    actorType: row.actorType,
    actorAgentId: row.actorAgentId,
    actor: row.actorUserId ? (refs.people[row.actorUserId] ?? null) : null,
    data: isRecord(row.data) ? row.data : {},
  }));

  return { entries, refs };
}
