import type { ColumnCategory } from "@prisma/client";

import { getIssueByKey } from "@/lib/services/issues";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { badRequest } from "@/lib/services/errors";
import { listMembers } from "@/lib/services/members";
import { getProjectWorkflow } from "@/lib/services/projects";

/**
 * MCP clients name things the way people do — "In Review", "frontend",
 * "ana@example.com", "WEB-3". These helpers turn names into the ids services
 * take, and fail with the valid choices so the model can correct itself.
 */

export type Workflow = Awaited<ReturnType<typeof getProjectWorkflow>>;

const CATEGORY_ALIASES: Record<string, ColumnCategory> = {
  todo: "TODO",
  "to do": "TODO",
  backlog: "TODO",
  in_progress: "IN_PROGRESS",
  "in progress": "IN_PROGRESS",
  inprogress: "IN_PROGRESS",
  doing: "IN_PROGRESS",
  done: "DONE",
  closed: "DONE",
};

const norm = (value: string) => value.trim().toLowerCase();

/** A column by exact name, else the first column of a category ("todo", "in_progress", "done"). */
export function resolveStatus(workflow: Workflow, status: string) {
  const wanted = norm(status);
  const byName = workflow.columns.find((c) => norm(c.name) === wanted);
  if (byName) return byName;
  const category = CATEGORY_ALIASES[wanted];
  const byCategory = category && workflow.columns.find((c) => c.category === category);
  if (byCategory) return byCategory;
  throw badRequest(
    `Unknown status "${status}" in ${workflow.key}. Use a column name (${workflow.columns
      .map((c) => `"${c.name}"`)
      .join(", ")}) or todo / in_progress / done.`,
  );
}

/** Label ids for label names (case-insensitive). Labels must already exist in the project. */
export function resolveLabels(workflow: Workflow, names: string[]) {
  return [...new Set(names.map(norm))].map((wanted) => {
    const label = workflow.labels.find((l) => norm(l.name) === wanted);
    if (!label) {
      throw badRequest(
        workflow.labels.length
          ? `Unknown label "${wanted}" in ${workflow.key}. Labels: ${workflow.labels.map((l) => l.name).join(", ")}.`
          : `${workflow.key} has no labels yet; create them in Kanso first.`,
      );
    }
    return label.id;
  });
}

/** "me", an email, or a member's exact name → user id; null unassigns. */
export async function resolveAssignee(ctx: Ctx, value: string | null): Promise<string | null> {
  if (value === null || norm(value) === "" || norm(value) === "none") return null;
  if (norm(value) === "me") return actingUserId(ctx);
  const members = (await listMembers(ctx)).filter((m) => m.role !== "GUEST");
  const wanted = norm(value);
  const byEmail = members.find((m) => norm(m.email) === wanted);
  if (byEmail) return byEmail.id;
  const byName = members.filter((m) => norm(m.name) === wanted);
  if (byName.length === 1) return byName[0]!.id;
  throw badRequest(
    `No assignable member "${value}". Use "me", an email, or null. Members: ${members
      .map((m) => `${m.name} <${m.email}>`)
      .join(", ")}.`,
  );
}

/** The epic's id for an issue key; it must be an EPIC in the same project. */
export async function resolveEpic(ctx: Ctx, key: string | null, projectKey: string) {
  if (key === null || key.trim() === "") return null;
  const epic = await getIssueByKey(ctx, key);
  if (epic.type !== "EPIC") throw badRequest(`${epic.key} is not an epic`);
  if (epic.project.key !== projectKey) throw badRequest(`${epic.key} is in another project`);
  return epic.id;
}

/** "WEB-42" → "WEB". */
export function projectKeyOf(issueKey: string) {
  return issueKey.trim().split("-")[0]!.toUpperCase();
}
