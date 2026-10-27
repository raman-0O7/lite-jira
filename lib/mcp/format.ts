import type { CallToolResult, InputRequiredResult } from "@modelcontextprotocol/server";
import { ZodError } from "zod";

import { QueryError } from "@/lib/query/issue-query";
import { ServiceError } from "@/lib/services/errors";

/**
 * Tool results. Data goes back as pretty JSON text (what every client renders)
 * and as structuredContent; failures the caller can fix are `isError` results
 * with a plain message, so the model sees what to change.
 */

export function ok(data: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function toolError(error: unknown): CallToolResult {
  let message: string;
  if (error instanceof ServiceError || error instanceof QueryError) {
    message = error.message;
  } else if (error instanceof ZodError) {
    message = error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ");
  } else {
    console.error(error);
    message = "Something went wrong";
  }
  return { isError: true, content: [{ type: "text", text: message }] };
}

/** Run a tool body, turning thrown service/validation errors into tool errors. */
export async function run<T extends CallToolResult | InputRequiredResult>(
  body: () => Promise<T>,
): Promise<T | CallToolResult> {
  try {
    return await body();
  } catch (error) {
    return toolError(error);
  }
}

const day = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

type Person = { name: string } | null;
type CardLike = {
  key: string;
  title: string;
  type: string;
  priority: string;
  dueDate: Date | null;
  estimate: number | null;
  assignee: Person;
  labels: { name: string }[];
  subIssueCount: number;
  subIssueDoneCount: number;
  column?: { name: string; category: string };
};

/** One issue in a list: enough to pick it, not everything. */
export function issueLine(issue: CardLike) {
  return {
    key: issue.key,
    title: issue.title,
    type: issue.type,
    priority: issue.priority,
    status: issue.column ? `${issue.column.name} (${issue.column.category})` : undefined,
    assignee: issue.assignee?.name ?? null,
    labels: issue.labels.map((l) => l.name),
    dueDate: day(issue.dueDate),
    estimate: issue.estimate,
    subIssues: issue.subIssueCount
      ? `${issue.subIssueDoneCount}/${issue.subIssueCount} done`
      : undefined,
  };
}

type FullLike = CardLike & {
  description: string | null;
  acceptanceCriteria: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  project: { key: string; name: string };
  column: { name: string; category: string };
  reporter: Person;
  parent: { key: string; title: string } | null;
  epic: { key: string; title: string } | null;
  subIssues: { key: string; title: string; done: boolean; assignee: Person }[];
};

/** Everything about one issue. */
export function issueDetail(issue: FullLike) {
  return {
    ...issueLine(issue),
    project: issue.project,
    description: issue.description,
    acceptanceCriteria: issue.acceptanceCriteria,
    reporter: issue.reporter?.name ?? null,
    parent: issue.parent && { key: issue.parent.key, title: issue.parent.title },
    epic: issue.epic && { key: issue.epic.key, title: issue.epic.title },
    subIssues: issue.subIssues.map((s) => ({
      key: s.key,
      title: s.title,
      done: s.done,
      assignee: s.assignee?.name ?? null,
    })),
    source: issue.source,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  };
}

const PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/** Most urgent first; then earliest due date; undated last. */
export function byUrgency(a: CardLike, b: CardLike) {
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p !== 0) return p;
  const da = a.dueDate?.getTime() ?? Infinity;
  const db = b.dueDate?.getTime() ?? Infinity;
  return da - db;
}
