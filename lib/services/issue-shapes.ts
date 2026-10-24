import type { Prisma } from "@prisma/client";

/**
 * Issue keys and the response shapes shared by every endpoint that returns
 * issues (board payload, search, issue detail), so a card looks the same
 * wherever it comes from.
 */

export function formatKey(projectKey: string, number: number) {
  return `${projectKey}-${number}`;
}

/** "web-42" → { projectKey: "WEB", number: 42 }, or null if it isn't a key. */
export function parseKey(key: string) {
  const match = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/.exec(key.trim());
  if (!match) return null;
  return { projectKey: match[1]!.toUpperCase(), number: Number(match[2]) };
}

const labelSelect = { select: { id: true, name: true, color: true } } as const;
const personSelect = { select: { id: true, name: true, image: true } } as const;

/** What a card on the board needs. */
export const cardSelect = {
  id: true,
  number: true,
  type: true,
  title: true,
  position: true,
  priority: true,
  dueDate: true,
  estimate: true,
  columnId: true,
  parentId: true,
  labels: labelSelect,
  assignee: personSelect,
  subIssues: { select: { column: { select: { category: true } } } },
} satisfies Prisma.IssueSelect;

type CardRow = Prisma.IssueGetPayload<{ select: typeof cardSelect }>;

export function toCard(projectKey: string, issue: CardRow) {
  const { subIssues, number, ...rest } = issue;
  return {
    ...rest,
    number,
    key: formatKey(projectKey, number),
    subIssueCount: subIssues.length,
    subIssueDoneCount: subIssues.filter((s) => s.column.category === "DONE").length,
  };
}

const relatedSelect = {
  select: { id: true, number: true, title: true, type: true },
} as const;

/** Everything the issue detail view shows. */
export const fullSelect = {
  ...cardSelect,
  description: true,
  acceptanceCriteria: true,
  projectId: true,
  epicId: true,
  assigneeUserId: true,
  assigneeAgentId: true,
  source: true,
  createdAt: true,
  updatedAt: true,
  project: { select: { key: true, name: true } },
  column: { select: { id: true, name: true, category: true } },
  reporter: personSelect,
  parent: relatedSelect,
  epic: relatedSelect,
  subIssues: {
    orderBy: { number: "asc" },
    select: {
      id: true,
      number: true,
      title: true,
      type: true,
      column: { select: { category: true } },
      assignee: personSelect,
    },
  },
} satisfies Prisma.IssueSelect;

type FullRow = Prisma.IssueGetPayload<{ select: typeof fullSelect }>;

export function toFull(issue: FullRow) {
  const projectKey = issue.project.key;
  const related = (r: { id: string; number: number; title: string; type: string } | null) =>
    r && { ...r, key: formatKey(projectKey, r.number) };
  const { subIssues, ...rest } = issue;
  return {
    ...rest,
    key: formatKey(projectKey, issue.number),
    parent: related(issue.parent),
    epic: related(issue.epic),
    subIssueCount: subIssues.length,
    subIssueDoneCount: subIssues.filter((s) => s.column.category === "DONE").length,
    subIssues: subIssues.map(({ column, ...s }) => ({
      ...s,
      key: formatKey(projectKey, s.number),
      done: column.category === "DONE",
    })),
  };
}
