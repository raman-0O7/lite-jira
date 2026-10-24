import { expect } from "vitest";

import { createIssue } from "@/lib/services/issues";
import type { Ctx } from "@/lib/services/context";
import { createProject, getProjectDetail } from "@/lib/services/projects";

/** A project with its default To Do / In Progress / Done columns. */
export async function makeProject(ctx: Ctx, name = "Web app", key?: string) {
  const project = await createProject(ctx, { name, key });
  const detail = await getProjectDetail(ctx, project.id);
  const [todo, doing, done] = detail.columns;
  return { project, todo: todo!, doing: doing!, done: done! };
}

export async function makeIssue(
  ctx: Ctx,
  columnId: string,
  title = "Issue",
  type?: "EPIC" | "STORY" | "TASK" | "BUG",
) {
  return createIssue(ctx, columnId, { title, type });
}

export async function columnTitles(ctx: Ctx, projectId: string) {
  const detail = await getProjectDetail(ctx, projectId);
  return detail.columns.map((c) => c.issues.map((i) => `${i.position}:${i.title}`));
}

/** Assert a service call rejects with a ServiceError of `status`. */
export async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toMatchObject({ status });
}
