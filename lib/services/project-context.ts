import type { ContextKind, ContextStatus, Prisma } from "@prisma/client";
import { z } from "zod";

import { ACTIVE_RUN } from "@/lib/agents/lifecycle";
import { issueRepository } from "@/lib/agents/repo";
import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import type { Ctx } from "@/lib/services/context";
import { badRequest, forbidden, notFound, ServiceError } from "@/lib/services/errors";
import { formatKey, parseKey } from "@/lib/services/issue-shapes";
import { projectScope } from "@/lib/services/scope";

/**
 * Project context (docs/features/27-project-context.md): a brief people write,
 * and sourced entries (decisions, constraints, conventions, vocabulary) that
 * agents propose and people accept. Only what a person accepted is ever served
 * to agents, so an injected GitHub issue can't spread through it.
 */

export const BRIEF_MAX = 20_000;
export const ENTRY_MAX = 1_000;
/** The most any response carries (about 8k tokens). */
export const CONTEXT_BUDGET = 30_000;
/** Pending proposals one agent run may have at once. */
export const RUN_PROPOSAL_LIMIT = 5;
export const FILES_MAX = 300;

export const CONTEXT_KINDS = ["DECISION", "CONSTRAINT", "CONVENTION", "VOCABULARY"] as const satisfies readonly ContextKind[];

const SECTION_TITLE: Record<ContextKind, string> = {
  DECISION: "Decisions",
  CONSTRAINT: "Constraints",
  CONVENTION: "Conventions",
  VOCABULARY: "Vocabulary",
};

// ---------- Who may do what ----------

/**
 * Adding accepted entries, deciding on proposals and editing the brief happen
 * only in the web app, as a person. MCP clients and API tokens (including
 * Claude Code or ChatGPT signed in as the person) can only propose: what an AI
 * writes is reviewed before it reaches other agents.
 */
function assertPerson(ctx: Ctx) {
  authorize(ctx, "context.write");
  if (ctx.actor.type !== "user" || ctx.via !== "web" || ctx.limits) {
    throw forbidden("Only people can change the project context in Kanso. Use propose_context to suggest an entry.");
  }
  return ctx.actor.userId;
}

async function findProject(ctx: Ctx, where: { id: string } | { key: string }) {
  authorize(ctx, "project.read");
  const project = await db.project.findFirst({
    where: { AND: [projectScope(ctx), "id" in where ? { id: where.id } : { key: where.key.trim().toUpperCase() }] },
    select: { id: true, key: true, name: true },
  });
  if (!project) throw notFound("Project not found");
  return project;
}

// ---------- Reading ----------

const entrySelect = {
  id: true,
  kind: true,
  text: true,
  status: true,
  sourcePrUrl: true,
  createdAt: true,
  decidedAt: true,
  archivedAt: true,
  replacesId: true,
  replacedBy: { where: { status: "ACCEPTED" }, take: 1, select: { id: true } },
  sourceIssue: { select: { id: true, number: true, title: true, source: true, project: { select: { key: true } } } },
  proposedBy: { select: { id: true, name: true } },
  proposedByAgent: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  runId: true,
} satisfies Prisma.ContextEntrySelect;

type EntryRow = Prisma.ContextEntryGetPayload<{ select: typeof entrySelect }>;

function toEntry(row: EntryRow) {
  return {
    id: row.id,
    kind: row.kind,
    text: row.text,
    status: row.status,
    archived: row.archivedAt !== null,
    // Replaced once its replacement has been accepted.
    replacedById: row.replacedBy[0]?.id ?? null,
    replacesId: row.replacesId,
    source: row.sourceIssue
      ? {
          issueId: row.sourceIssue.id,
          key: formatKey(row.sourceIssue.project.key, row.sourceIssue.number),
          title: row.sourceIssue.title,
          fromGitHub: row.sourceIssue.source === "GITHUB",
        }
      : null,
    sourcePrUrl: row.sourcePrUrl,
    proposedBy: row.proposedByAgent
      ? { type: "agent" as const, id: row.proposedByAgent.id, name: row.proposedByAgent.name }
      : row.proposedBy
        ? { type: "user" as const, id: row.proposedBy.id, name: row.proposedBy.name }
        : null,
    decidedBy: row.decidedBy ? { id: row.decidedBy.id, name: row.decidedBy.name } : null,
    decidedAt: row.decidedAt,
    runId: row.runId,
    createdAt: row.createdAt,
  };
}

export type ContextEntryView = ReturnType<typeof toEntry>;

/** Whether an entry is served to agents: accepted, not archived, not replaced. */
const isLive = (entry: ContextEntryView) => entry.status === "ACCEPTED" && !entry.archived && !entry.replacedById;

/** The brief and every entry of a project, for the Context page. */
export async function getProjectContext(ctx: Ctx, projectId: string) {
  const project = await findProject(ctx, { id: projectId });
  const [brief, rows] = await Promise.all([
    db.projectBrief.findUnique({ where: { projectId: project.id }, select: { body: true, version: true, updatedAt: true } }),
    db.contextEntry.findMany({
      where: { projectId: project.id, status: { not: "REJECTED" } },
      orderBy: { createdAt: "desc" },
      select: entrySelect,
    }),
  ]);
  const entries = rows.map(toEntry);
  return {
    project,
    brief: brief ?? { body: "", version: 0, updatedAt: null },
    entries,
    counts: {
      proposed: entries.filter((e) => e.status === "PROPOSED" && !e.archived).length,
      live: entries.filter(isLive).length,
    },
  };
}

/** Proposals made from an issue's runs, for its activity. */
export async function listIssueProposals(ctx: Ctx, issueId: string) {
  authorize(ctx, "project.read");
  const rows = await db.contextEntry.findMany({
    where: { sourceIssueId: issueId, status: "PROPOSED", archivedAt: null, project: projectScope(ctx) },
    orderBy: { createdAt: "asc" },
    select: entrySelect,
  });
  return rows.map(toEntry);
}

// ---------- Rendering (pure) ----------

type RenderInput = {
  project: { key: string; name: string };
  brief: string;
  /** Live entries (accepted, not archived, not replaced), newest first. */
  entries: Pick<ContextEntryView, "kind" | "text" | "source" | "sourcePrUrl" | "decidedBy" | "decidedAt" | "createdAt">[];
  page?: number;
  budget?: number;
};

const day = (date: Date | null) =>
  date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null;

function entryLine(entry: RenderInput["entries"][number]) {
  const source = [entry.source?.key, entry.sourcePrUrl ? `PR ${entry.sourcePrUrl}` : null].filter(Boolean).join(", ");
  const accepted = entry.decidedBy ? `accepted by ${entry.decidedBy.name}, ${day(entry.decidedAt ?? entry.createdAt)}` : null;
  const meta = [source, accepted].filter(Boolean).join(" · ");
  const text = entry.text.replace(/\s*\n\s*/g, " ");
  return `- ${text}${meta ? ` (${meta})` : ""}`;
}

/**
 * The context as agents receive it. Page 1 carries the brief and as many
 * entries as fit in the budget (newest first, by section); later pages carry
 * the rest. A footer says what was left out and how to get it.
 */
export function renderContext({ project, brief, entries, page = 1, budget = CONTEXT_BUDGET }: RenderInput) {
  const header = [
    `# Project context: ${project.name} (${project.key})`,
    "Accepted by the team. Follow it; if your work changes any of it, propose an update with propose_context.",
  ].join("\n");
  const briefBlock = brief.trim() ? `## Brief\n${brief.trim()}` : "## Brief\n_No brief yet._";

  // Entries in reading order: by section, newest first within each.
  const ordered = CONTEXT_KINDS.flatMap((kind) => entries.filter((e) => e.kind === kind).map((e) => ({ kind, line: entryLine(e) })));

  // Pack entries into pages. Every page pays for the header, its section
  // headings, a note and the footer; page 1 also carries the brief.
  const fixed = header.length + 2 + 200;
  const pages: (typeof ordered)[] = [];
  let current: typeof ordered = [];
  let used = fixed + briefBlock.length + 2;
  let seen = new Set<ContextKind>();
  for (const item of ordered) {
    let cost = item.line.length + 1 + (seen.has(item.kind) ? 0 : SECTION_TITLE[item.kind].length + 6);
    if (current.length && used + cost > budget) {
      pages.push(current);
      current = [];
      seen = new Set();
      used = fixed;
      cost = item.line.length + 1 + SECTION_TITLE[item.kind].length + 6;
    }
    current.push(item);
    seen.add(item.kind);
    used += cost;
  }
  pages.push(current);

  const total = pages.length;
  const index = Math.min(Math.max(1, Math.floor(page)), total);
  const shown = pages[index - 1] ?? [];
  const parts = [header];
  if (index === 1) parts.push(briefBlock);
  else parts.push(`_Page ${index} of ${total}: entries only. The brief is on page 1._`);
  for (const kind of CONTEXT_KINDS) {
    const lines = shown.filter((item) => item.kind === kind).map((item) => item.line);
    if (lines.length) parts.push(`## ${SECTION_TITLE[kind]}\n${lines.join("\n")}`);
  }
  if (!ordered.length && index === 1) parts.push("_No decisions, constraints, conventions or vocabulary yet._");
  const later = pages.slice(index).reduce((sum, p) => sum + p.length, 0);
  if (later) {
    parts.push(`_${later} more ${later === 1 ? "entry" : "entries"} not shown: call get_project_context with page ${index + 1}._`);
  }

  let markdown = parts.join("\n\n");
  // A brief at its maximum plus a long project name can't overflow the budget.
  if (markdown.length > budget) markdown = `${markdown.slice(0, budget - 40)}\n\n_(cut to fit the size limit)_`;
  return { markdown, page: index, pages: total, entriesShown: shown.length, entriesTotal: ordered.length };
}

/** The rendered context of a project, by id or key. */
export async function getRenderedContext(
  ctx: Ctx,
  where: { id: string } | { key: string },
  page = 1,
  budget = CONTEXT_BUDGET,
) {
  const project = await findProject(ctx, where);
  const [brief, rows] = await Promise.all([
    db.projectBrief.findUnique({ where: { projectId: project.id }, select: { body: true } }),
    db.contextEntry.findMany({
      where: { projectId: project.id, status: "ACCEPTED", archivedAt: null },
      orderBy: [{ decidedAt: "desc" }, { createdAt: "desc" }],
      select: entrySelect,
    }),
  ]);
  const entries = rows.map(toEntry).filter(isLive);
  const empty = !brief?.body.trim() && !entries.length;
  return { project, empty, ...renderContext({ project, brief: brief?.body ?? "", entries, page, budget }) };
}

// ---------- The brief ----------

const briefSchema = z.object({
  body: z.string().max(BRIEF_MAX, `The brief can be at most ${BRIEF_MAX.toLocaleString("en")} characters`),
  version: z.number().int().min(0),
});

/** Save the brief. A stale version (someone else saved since) is a 409. */
export async function saveBrief(ctx: Ctx, projectId: string, input: unknown) {
  const userId = assertPerson(ctx);
  const project = await findProject(ctx, { id: projectId });
  const { body, version } = briefSchema.parse(input);
  return writeBrief(ctx, project.id, userId, body, version);
}

async function writeBrief(ctx: Ctx, projectId: string, userId: string, body: string, version: number) {
  return db.$transaction(async (tx) => {
    const current = await tx.projectBrief.findUnique({ where: { projectId }, select: { version: true } });
    if ((current?.version ?? 0) !== version) {
      throw new ServiceError(409, "Someone else saved the brief; reload to see their changes");
    }
    const next = version + 1;
    const saved = await tx.projectBrief.upsert({
      where: { projectId },
      create: { projectId, body, version: next },
      update: { body, version: next },
      select: { body: true, version: true, updatedAt: true },
    });
    await tx.projectBriefRevision.create({ data: { projectId, version: next, body, editedById: userId } });
    await recordActivity(tx, ctx, { action: "context.brief_updated", projectId, data: { version: next } });
    return saved;
  });
}

/** Saved versions of the brief, newest first. */
export async function listBriefRevisions(ctx: Ctx, projectId: string) {
  const project = await findProject(ctx, { id: projectId });
  return db.projectBriefRevision.findMany({
    where: { projectId: project.id },
    orderBy: { version: "desc" },
    take: 50,
    select: { version: true, body: true, createdAt: true, editedBy: { select: { id: true, name: true } } },
  });
}

/** Restore an old version: saved as a new version, so history only grows. */
export async function restoreBriefRevision(ctx: Ctx, projectId: string, version: number) {
  const userId = assertPerson(ctx);
  const project = await findProject(ctx, { id: projectId });
  const revision = await db.projectBriefRevision.findUnique({
    where: { projectId_version: { projectId: project.id, version } },
    select: { body: true },
  });
  if (!revision) throw notFound("That version doesn't exist");
  const current = await db.projectBrief.findUnique({ where: { projectId: project.id }, select: { version: true } });
  return writeBrief(ctx, project.id, userId, revision.body, current?.version ?? 0);
}

// ---------- Entries ----------

const entryText = z
  .string()
  .trim()
  .min(1, "Write the entry")
  .max(ENTRY_MAX, `An entry can be at most ${ENTRY_MAX.toLocaleString("en")} characters: one fact per entry`);

const addSchema = z.object({
  kind: z.enum(CONTEXT_KINDS),
  text: entryText,
  issueId: z.string().min(1).optional(),
  replacesId: z.string().min(1).optional(),
});

/** An entry a member adds on the Context page: accepted at once. */
export async function addEntry(ctx: Ctx, projectId: string, input: unknown) {
  const userId = assertPerson(ctx);
  const project = await findProject(ctx, { id: projectId });
  const data = addSchema.parse(input);
  const sourceIssueId = data.issueId ? (await findIssue(ctx, project.id, { id: data.issueId })).id : null;
  return db.$transaction(async (tx) => {
    if (data.replacesId) await checkReplaceable(tx, project.id, data.replacesId);
    const entry = await tx.contextEntry.create({
      data: {
        projectId: project.id,
        kind: data.kind,
        text: data.text,
        status: "ACCEPTED",
        sourceIssueId,
        proposedByUserId: userId,
        decidedByUserId: userId,
        decidedAt: new Date(),
        replacesId: data.replacesId ?? null,
      },
      select: entrySelect,
    });
    await recordActivity(tx, ctx, {
      action: "context.entry_added",
      projectId: project.id,
      issueId: sourceIssueId ?? undefined,
      data: { entryId: entry.id, kind: entry.kind, ...(data.replacesId ? { replacesId: data.replacesId } : {}) },
    });
    return toEntry(entry);
  });
}

const proposeSchema = z.object({
  kind: z.enum(CONTEXT_KINDS),
  text: entryText,
  issueKey: z.string().trim().min(1).optional(),
  replaces: z.string().trim().min(1).optional(),
});

/**
 * An entry suggested over MCP: always a proposal, waiting for a person. When
 * it names an issue that an agent of the caller has claimed (its own token,
 * or the person who owns or runs it), it's attributed to that agent and run,
 * and the run's pending proposals are capped.
 */
export async function proposeEntry(ctx: Ctx, projectKey: string, input: unknown) {
  authorize(ctx, "context.write");
  const project = await findProject(ctx, { key: projectKey });
  const data = proposeSchema.parse(input);

  let sourceIssueId: string | null = null;
  let agent: { id: string; ownerUserId: string } | null = null;
  let runId: string | null = null;
  if (data.issueKey) {
    const issue = await findIssue(ctx, project.id, { key: data.issueKey });
    sourceIssueId = issue.id;
    const run = await proposingRun(ctx, issue.id);
    if (run) {
      agent = run.agent;
      runId = run.id;
    }
  } else if (ctx.actor.type === "agent") {
    const own = await db.agent.findUnique({ where: { id: ctx.actor.agentId }, select: { id: true, ownerUserId: true } });
    agent = own;
  }

  // Already there, accepted or waiting: nothing new to review.
  const normalized = data.text.toLowerCase().replace(/\s+/g, " ");
  const existing = await db.contextEntry.findMany({
    where: { projectId: project.id, kind: data.kind, status: { in: ["ACCEPTED", "PROPOSED"] }, archivedAt: null },
    select: entrySelect,
  });
  const duplicate = existing.find((e) => e.text.toLowerCase().replace(/\s+/g, " ") === normalized);
  if (duplicate) return { entry: toEntry(duplicate), duplicate: true };

  if (data.replaces) {
    const target = await db.contextEntry.findFirst({ where: { id: data.replaces, projectId: project.id }, select: { id: true } });
    if (!target) throw notFound("The entry to replace wasn't found in this project");
  }
  if (runId) {
    const pending = await db.contextEntry.count({ where: { runId, status: "PROPOSED", archivedAt: null } });
    if (pending >= RUN_PROPOSAL_LIMIT) {
      throw new ServiceError(429, `This run already has ${RUN_PROPOSAL_LIMIT} proposals waiting for review.`);
    }
  }

  const actorCtx: Ctx =
    agent && ctx.actor.type !== "agent" ? { ...ctx, actor: { type: "agent", agentId: agent.id, onBehalfOf: agent.ownerUserId } } : ctx;
  const proposerUserId = ctx.actor.type === "user" ? ctx.actor.userId : ctx.actor.type === "agent" ? ctx.actor.onBehalfOf : null;

  return db.$transaction(async (tx) => {
    const entry = await tx.contextEntry.create({
      data: {
        projectId: project.id,
        kind: data.kind,
        text: data.text,
        status: "PROPOSED",
        sourceIssueId,
        proposedByUserId: agent ? null : proposerUserId,
        proposedByAgentId: agent?.id ?? null,
        runId,
        // Checked again when it's accepted: the target may change meanwhile.
        replacesId: data.replaces ?? null,
      },
      select: entrySelect,
    });
    await recordActivity(tx, actorCtx, {
      action: "context.entry_proposed",
      projectId: project.id,
      issueId: sourceIssueId ?? undefined,
      data: { entryId: entry.id, kind: entry.kind, text: entry.text.slice(0, 300), ...(data.replaces ? { replacesId: data.replaces } : {}) },
    });
    return { entry: toEntry(entry), duplicate: false };
  });
}

/** The active run on an issue that the caller is (or speaks for), if any. */
async function proposingRun(ctx: Ctx, issueId: string) {
  const base = { issueId, status: { in: ACTIVE_RUN } } satisfies Prisma.AgentRunWhereInput;
  const where: Prisma.AgentRunWhereInput =
    ctx.actor.type === "agent"
      ? { ...base, agentId: ctx.actor.agentId }
      : ctx.actor.type === "user"
        ? { ...base, OR: [{ agent: { ownerUserId: ctx.actor.userId } }, { runnerUserId: ctx.actor.userId }] }
        : { id: "" };
  return db.agentRun.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true, agent: { select: { id: true, ownerUserId: true } } },
  });
}

const decideSchema = z.object({
  action: z.enum(["accept", "reject", "archive"]),
  text: entryText.optional(),
  replacesId: z.string().min(1).nullish(),
});

/** Accept (optionally edited), reject, or archive an entry. People only. */
export async function decideEntry(ctx: Ctx, entryId: string, input: unknown) {
  const userId = assertPerson(ctx);
  authorize(ctx, "project.read");
  const data = decideSchema.parse(input);
  const entry = await db.contextEntry.findFirst({
    where: { id: entryId, project: projectScope(ctx) },
    select: { id: true, projectId: true, status: true, archivedAt: true, sourceIssueId: true, replacesId: true },
  });
  if (!entry) throw notFound("Entry not found");

  return db.$transaction(async (tx) => {
    let action: "context.entry_accepted" | "context.entry_rejected" | "context.entry_archived";
    let update: Prisma.ContextEntryUpdateInput;
    if (data.action === "archive") {
      if (entry.archivedAt) throw new ServiceError(409, "That entry is already archived");
      action = "context.entry_archived";
      update = { archivedAt: new Date() };
    } else {
      if (entry.status !== "PROPOSED" || entry.archivedAt) throw new ServiceError(409, "That entry has already been decided");
      if (data.action === "reject") {
        action = "context.entry_rejected";
        update = { status: "REJECTED", decidedBy: { connect: { id: userId } }, decidedAt: new Date() };
      } else {
        action = "context.entry_accepted";
        const replacesId = data.replacesId === undefined ? entry.replacesId : data.replacesId;
        if (replacesId) await checkReplaceable(tx, entry.projectId, replacesId, entry.id);
        update = {
          status: "ACCEPTED",
          decidedBy: { connect: { id: userId } },
          decidedAt: new Date(),
          ...(data.text ? { text: data.text } : {}),
          replaces: replacesId ? { connect: { id: replacesId } } : { disconnect: true },
        };
      }
    }
    const saved = await tx.contextEntry.update({ where: { id: entry.id }, data: update, select: entrySelect });
    await recordActivity(tx, ctx, {
      action,
      projectId: entry.projectId,
      issueId: entry.sourceIssueId ?? undefined,
      data: { entryId: entry.id, kind: saved.kind, ...(data.action === "accept" && data.text ? { edited: true } : {}) },
    });
    return toEntry(saved);
  });
}

/** An entry can replace only a live accepted entry of the same project, and only one entry can replace it. */
async function checkReplaceable(tx: Prisma.TransactionClient, projectId: string, replacesId: string, selfId?: string) {
  if (replacesId === selfId) throw badRequest("An entry can't replace itself");
  const target = await tx.contextEntry.findFirst({
    where: { id: replacesId, projectId },
    select: { status: true, archivedAt: true, replacedBy: { where: { status: "ACCEPTED", id: { not: selfId ?? "" } }, select: { id: true } } },
  });
  if (!target) throw notFound("The entry to replace wasn't found in this project");
  if (target.status !== "ACCEPTED" || target.archivedAt) throw badRequest("Only an accepted entry can be replaced");
  if (target.replacedBy.length) throw new ServiceError(409, "That entry has already been replaced");
}

async function findIssue(ctx: Ctx, projectId: string, where: { id: string } | { key: string }) {
  let issueWhere: Prisma.IssueWhereInput;
  if ("id" in where) issueWhere = { id: where.id };
  else {
    const parsed = parseKey(where.key);
    if (!parsed) throw badRequest(`${where.key} isn't an issue key`);
    issueWhere = { number: parsed.number, project: { key: parsed.projectKey } };
  }
  const issue = await db.issue.findFirst({ where: { AND: [issueWhere, { projectId }] }, select: { id: true } });
  if (!issue) throw notFound("Issue not found in this project");
  return issue;
}

// ---------- Overlaps ----------

/** A changed-file path as an agent reports it: relative, no `..`, printable. */
export const filePath = z
  .string()
  .trim()
  .max(500)
  .transform((path) => path.replace(/^\.\//, ""))
  .refine((path) => path.length > 0, "Empty path")
  .refine((path) => !path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path), "Use paths relative to the repository root")
  .refine((path) => !path.split(/[\\/]/).includes(".."), "Paths can't contain ..")
  .refine((path) => !/[\u0000-\u001f\u007f]/.test(path), "Paths can't contain control characters");

export const filesSchema = z.array(filePath).max(FILES_MAX, `At most ${FILES_MAX} paths`);

export type Overlap = {
  issueId: string;
  key: string;
  title: string;
  repository: string;
  files: string[];
  /** Who is changing it: an agent's name, or null for a person's PR. */
  agent: string | null;
  pullRequest: { number: number; url: string } | null;
};

type WorkItem = { repository: string; files: string[] };

/** What an issue is changing right now: its open PRs' files, else its active run's planned files. */
async function issueWork(issueId: string): Promise<WorkItem[]> {
  const [prs, run] = await Promise.all([
    db.pullRequestLink.findMany({ where: { issueId, state: "OPEN" }, select: { repoFullName: true, files: true } }),
    db.agentRun.findFirst({
      where: { issueId, status: { in: ACTIVE_RUN } },
      orderBy: { createdAt: "desc" },
      select: { plannedFiles: true },
    }),
  ]);
  const work: WorkItem[] = prs.filter((pr) => pr.files.length).map((pr) => ({ repository: pr.repoFullName, files: pr.files }));
  if (run?.plannedFiles.length) {
    const repo = await issueRepository(issueId);
    if (repo && !work.some((w) => w.repository === repo.fullName)) work.push({ repository: repo.fullName, files: run.plannedFiles });
  }
  return work;
}

/**
 * Other active work in the same repositories changing the same files: open
 * PRs linked to other issues (anyone's), and active agent runs without a PR
 * yet. Computed on demand, so it never goes stale. Only issues the caller can
 * see are reported.
 */
export async function issueOverlaps(ctx: Ctx, issueId: string): Promise<Overlap[]> {
  authorize(ctx, "project.read");
  const issue = await db.issue.findFirst({ where: { id: issueId, project: projectScope(ctx) }, select: { id: true } });
  if (!issue) throw notFound("Issue not found");
  const mine = await issueWork(issue.id);
  if (!mine.length) return [];

  const visible = { project: projectScope(ctx) } satisfies Prisma.IssueWhereInput;
  const found = new Map<string, Overlap>();
  const add = (other: { id: string; number: number; title: string; project: { key: string } }, item: Omit<Overlap, "issueId" | "key" | "title">) => {
    const existing = found.get(other.id);
    if (existing) {
      existing.files = [...new Set([...existing.files, ...item.files])];
      existing.agent ??= item.agent;
      existing.pullRequest ??= item.pullRequest;
      return;
    }
    found.set(other.id, { issueId: other.id, key: formatKey(other.project.key, other.number), title: other.title, ...item });
  };
  const otherIssue = { select: { id: true, number: true, title: true, project: { select: { key: true } } } } as const;

  for (const work of mine) {
    const [prs, runs] = await Promise.all([
      db.pullRequestLink.findMany({
        where: { state: "OPEN", repoFullName: work.repository, issueId: { not: issue.id }, files: { hasSome: work.files }, issue: visible },
        select: { number: true, url: true, files: true, issue: otherIssue },
      }),
      db.agentRun.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          status: { in: ACTIVE_RUN },
          issueId: { not: issue.id },
          plannedFiles: { hasSome: work.files },
          issue: visible,
        },
        select: { plannedFiles: true, issueId: true, agent: { select: { name: true } }, issue: otherIssue },
      }),
    ]);
    const mineSet = new Set(work.files);
    for (const pr of prs) {
      const agentRun = await db.agentRun.findFirst({
        where: { issueId: pr.issue.id, status: { in: ACTIVE_RUN } },
        select: { agent: { select: { name: true } } },
      });
      add(pr.issue, {
        repository: work.repository,
        files: pr.files.filter((f) => mineSet.has(f)),
        agent: agentRun?.agent.name ?? null,
        pullRequest: { number: pr.number, url: pr.url },
      });
    }
    for (const run of runs) {
      // Only runs in the same repository, and only before they have a PR there (PR files win).
      const repo = await issueRepository(run.issueId);
      if (repo?.fullName !== work.repository) continue;
      add(run.issue, { repository: work.repository, files: run.plannedFiles.filter((f) => mineSet.has(f)), agent: run.agent.name, pullRequest: null });
    }
  }
  return [...found.values()].map((o) => ({ ...o, files: o.files.sort() }));
}

/**
 * Overlaps for every issue in a project that has active work, for the board's
 * chips: one request per board instead of one per card.
 */
export async function projectOverlaps(ctx: Ctx, projectId: string): Promise<Record<string, Overlap[]>> {
  const project = await findProject(ctx, { id: projectId });
  const active = await db.issue.findMany({
    where: {
      projectId: project.id,
      OR: [
        { pullRequests: { some: { state: "OPEN", NOT: { files: { isEmpty: true } } } } },
        { agentRuns: { some: { status: { in: ACTIVE_RUN }, NOT: { plannedFiles: { isEmpty: true } } } } },
      ],
    },
    take: 200,
    select: { id: true },
  });
  const result: Record<string, Overlap[]> = {};
  for (const { id } of active) {
    const overlaps = await issueOverlaps(ctx, id);
    if (overlaps.length) result[id] = overlaps;
  }
  return result;
}

/** Overlaps as lines an agent reads in its tool responses. */
export function describeOverlaps(overlaps: Overlap[]) {
  return overlaps.map((o) => {
    const who = o.agent ? `being worked by ${o.agent}` : "being worked on by a person";
    const files = o.files.slice(0, 10).map((f) => `\`${f}\``).join(", ") + (o.files.length > 10 ? ` and ${o.files.length - 10} more` : "");
    const pr = o.pullRequest ? ` (PR ${o.repository}#${o.pullRequest.number})` : "";
    return `${o.key}, ${who}, is changing ${files} too${pr}.`;
  });
}

/** Record the files an agent's run plans to change (report_progress `files`). */
export async function setPlannedFiles(runId: string, files: string[]) {
  await db.agentRun.update({ where: { id: runId }, data: { plannedFiles: [...new Set(files)].slice(0, FILES_MAX) } });
}

export type { ContextKind, ContextStatus };
