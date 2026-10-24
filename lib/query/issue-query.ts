import type { ColumnCategory, IssueType, Prisma, Priority } from "@prisma/client";

/**
 * The issue query language shared by the UI, MCP `search_issues`, and saved
 * filters (docs/features/07-issue-model.md §Query language).
 *
 *   assignee:me type:bug,story is:open label:auth "login page" WEB-42
 *
 * Terms are ANDed; commas OR the values of one term. Unknown terms or values
 * throw QueryError so callers learn the syntax instead of getting silently
 * wrong results.
 */

export class QueryError extends Error {
  name = "QueryError";
}

type DueValue = "overdue" | "today" | "week" | "none";

export type IssueQuery = {
  assignee: string[];
  type: IssueType[];
  status: ColumnCategory[];
  is: ("open" | "done")[];
  priority: Priority[];
  label: string[];
  project: string[];
  epic: { projectKey: string; number: number }[];
  parent: { projectKey: string; number: number }[];
  due: DueValue[];
  keys: { projectKey: string; number: number }[];
  text: string[];
};

const ISSUE_KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/;

function asKey(value: string) {
  const match = ISSUE_KEY.exec(value);
  return match ? { projectKey: match[1]!.toUpperCase(), number: Number(match[2]) } : null;
}

function oneOf<T extends string>(term: string, value: string, allowed: Record<string, T>): T {
  const hit = allowed[value.toLowerCase()];
  if (!hit) {
    throw new QueryError(
      `Unknown value "${value}" for ${term}: — use one of ${[...new Set(Object.keys(allowed))].join(", ")}`,
    );
  }
  return hit;
}

const TYPES: Record<string, IssueType> = {
  epic: "EPIC",
  story: "STORY",
  task: "TASK",
  bug: "BUG",
  subtask: "SUBTASK",
  "sub-task": "SUBTASK",
};
const STATUSES: Record<string, ColumnCategory> = {
  todo: "TODO",
  in_progress: "IN_PROGRESS",
  inprogress: "IN_PROGRESS",
  doing: "IN_PROGRESS",
  done: "DONE",
};
const PRIORITIES: Record<string, Priority> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
  urgent: "URGENT",
};
const IS: Record<string, "open" | "done"> = { open: "open", done: "done" };
const DUE: Record<string, DueValue> = {
  overdue: "overdue",
  today: "today",
  week: "week",
  none: "none",
};

const TERMS = [
  "assignee",
  "type",
  "status",
  "is",
  "priority",
  "label",
  "project",
  "epic",
  "parent",
  "due",
] as const;

export function parseIssueQuery(input: string): IssueQuery {
  const query: IssueQuery = {
    assignee: [],
    type: [],
    status: [],
    is: [],
    priority: [],
    label: [],
    project: [],
    epic: [],
    parent: [],
    due: [],
    keys: [],
    text: [],
  };

  // A bare "term:" (no value) still parses as a term so it can be reported.
  const tokens = /([A-Za-z_]+):(?:"([^"]*)"|(\S*))|"([^"]*)"|(\S+)/g;
  for (const match of input.matchAll(tokens)) {
    const [, rawTerm, quotedValue, plainValue, quotedText, word] = match;

    if (rawTerm) {
      const term = rawTerm.toLowerCase();
      if (!(TERMS as readonly string[]).includes(term)) {
        throw new QueryError(`Unknown term "${rawTerm}:" — use one of ${TERMS.map((t) => `${t}:`).join(" ")}`);
      }
      const values = (quotedValue ?? plainValue ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      if (values.length === 0) throw new QueryError(`"${rawTerm}:" needs a value`);

      for (const value of values) {
        switch (term) {
          case "assignee":
            query.assignee.push(value.toLowerCase());
            break;
          case "type":
            query.type.push(oneOf(term, value, TYPES));
            break;
          case "status":
            query.status.push(oneOf(term, value, STATUSES));
            break;
          case "is":
            query.is.push(oneOf(term, value, IS));
            break;
          case "priority":
            query.priority.push(oneOf(term, value, PRIORITIES));
            break;
          case "label":
            query.label.push(value);
            break;
          case "project":
            query.project.push(value.toUpperCase());
            break;
          case "due":
            query.due.push(oneOf(term, value, DUE));
            break;
          case "epic":
          case "parent": {
            const key = asKey(value);
            if (!key) throw new QueryError(`${term}: expects an issue key like WEB-12, got "${value}"`);
            query[term].push(key);
            break;
          }
        }
      }
      continue;
    }

    const text = quotedText ?? word ?? "";
    const key = quotedText === undefined ? asKey(text) : null;
    if (key) query.keys.push(key);
    else if (text.trim()) query.text.push(text.trim());
  }

  return query;
}

const startOfDayUtc = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const DAY = 24 * 60 * 60 * 1000;

const byKey = (k: { projectKey: string; number: number }) => ({
  number: k.number,
  project: { key: k.projectKey },
});

/**
 * Turn a parsed query into a Prisma filter. `userId` resolves `assignee:me`
 * (null for actors with no user, which makes `me` an error).
 */
export function issueQueryToWhere(
  query: IssueQuery,
  { userId, now = new Date() }: { userId: string | null; now?: Date },
): Prisma.IssueWhereInput {
  const and: Prisma.IssueWhereInput[] = [];
  const anyOf = (clauses: Prisma.IssueWhereInput[]) => {
    if (clauses.length) and.push(clauses.length === 1 ? clauses[0]! : { OR: clauses });
  };

  anyOf(
    query.assignee.map((value) => {
      if (value === "none") return { assigneeUserId: null };
      if (value === "me") {
        if (!userId) throw new QueryError("assignee:me needs a signed-in user");
        return { assigneeUserId: userId };
      }
      return { assignee: { email: { equals: value, mode: "insensitive" } } };
    }),
  );
  if (query.type.length) and.push({ type: { in: query.type } });
  if (query.status.length) and.push({ column: { category: { in: query.status } } });
  const is = new Set(query.is);
  if (is.size === 1) {
    and.push({ column: { category: is.has("done") ? "DONE" : { not: "DONE" } } });
  }
  if (query.priority.length) and.push({ priority: { in: query.priority } });
  anyOf(
    query.label.map((name) => ({
      labels: { some: { name: { equals: name, mode: "insensitive" } } },
    })),
  );
  if (query.project.length) and.push({ project: { key: { in: query.project } } });
  anyOf(query.epic.map((k) => ({ epic: byKey(k) })));
  anyOf(query.parent.map((k) => ({ parent: byKey(k) })));

  const today = startOfDayUtc(now);
  anyOf(
    query.due.map((value) => {
      switch (value) {
        case "none":
          return { dueDate: null };
        case "overdue":
          return { dueDate: { lt: today }, column: { category: { not: "DONE" } } };
        case "today":
          return { dueDate: { gte: today, lt: new Date(today.getTime() + DAY) } };
        case "week":
          return { dueDate: { gte: today, lt: new Date(today.getTime() + 7 * DAY) } };
      }
    }),
  );
  anyOf(query.keys.map(byKey));
  for (const text of query.text) {
    and.push({
      OR: [
        { title: { contains: text, mode: "insensitive" } },
        { description: { contains: text, mode: "insensitive" } },
      ],
    });
  }

  return and.length ? { AND: and } : {};
}
