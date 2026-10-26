import { Prisma } from "@prisma/client";

import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import type { Ctx } from "@/lib/services/context";
import { badRequest, notFound, ServiceError } from "@/lib/services/errors";
import { cardSelect, toCard } from "@/lib/services/issue-shapes";
import { projectScope } from "@/lib/services/scope";
import {
  createProjectSchema,
  projectKeySchema,
  updateProjectSchema,
} from "@/lib/validations/project";

/** Columns seeded into every new project, in display order. */
const DEFAULT_COLUMNS = [
  { name: "To Do", category: "TODO" },
  { name: "In Progress", category: "IN_PROGRESS" },
  { name: "Done", category: "DONE" },
] as const;

const summarySelect = {
  id: true,
  name: true,
  key: true,
  mode: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { columns: true, issues: true } },
} satisfies Prisma.ProjectSelect;

type SummaryRow = Prisma.ProjectGetPayload<{ select: typeof summarySelect }>;

function toSummary(project: SummaryRow) {
  const { _count, ...rest } = project;
  return { ...rest, columnCount: _count.columns, issueCount: _count.issues };
}

/**
 * A key suggestion from a project name: the first three letters, upper-cased
 * ("Web app" → "WEB"), padded to two characters, "PRJ" when there are none.
 */
export function suggestKey(name: string): string {
  const letters = name.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (letters.length === 0) return "PRJ";
  return letters.length === 1 ? `${letters}P` : letters.slice(0, 3);
}

/** Resolve a project inside the ctx workspace, or throw 404. */
export async function findProjectInWorkspace(
  client: Prisma.TransactionClient,
  ctx: Ctx,
  projectId: string,
) {
  const project = await client.project.findFirst({
    where: { id: projectId, ...projectScope(ctx) },
    select: { id: true, name: true, key: true },
  });
  if (!project) throw notFound("Project not found");
  return project;
}

/** Id, name, and key of a project, or 404. */
export async function getProject(ctx: Ctx, projectId: string) {
  authorize(ctx, "project.read");
  return findProjectInWorkspace(db, ctx, projectId);
}

export async function listProjects(ctx: Ctx) {
  authorize(ctx, "project.read");
  const projects = await db.project.findMany({
    where: { ...projectScope(ctx), archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: summarySelect,
  });
  return projects.map(toSummary);
}

/** Id, name, and key of a project by its key, or 404. */
export async function getProjectByKey(ctx: Ctx, key: string) {
  authorize(ctx, "project.read");
  const project = await db.project.findFirst({
    where: { ...projectScope(ctx), key: key.toUpperCase() },
    select: { id: true, name: true, key: true },
  });
  if (!project) throw notFound("Project not found");
  return project;
}

/** The project with its ordered columns and their ordered issue cards. */
export async function getProjectDetail(ctx: Ctx, projectId: string) {
  authorize(ctx, "project.read");
  const project = await db.project.findFirst({
    where: { id: projectId, ...projectScope(ctx) },
    select: {
      id: true,
      name: true,
      key: true,
      mode: true,
      createdAt: true,
      updatedAt: true,
      columns: {
        orderBy: { position: "asc" },
        select: {
          id: true,
          name: true,
          position: true,
          category: true,
          issues: { orderBy: { position: "asc" }, select: cardSelect },
        },
      },
    },
  });
  if (!project) throw notFound("Project not found");
  return {
    ...project,
    columns: project.columns.map((column) => ({
      ...column,
      issues: column.issues.map((issue) => toCard(project.key, issue)),
    })),
  };
}

export async function createProject(ctx: Ctx, input: unknown) {
  authorize(ctx, "project.create");
  const parsed = createProjectSchema.parse(input);
  const key = parsed.key ?? projectKeySchema.parse(suggestKey(parsed.name));

  try {
    return await db.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: parsed.name,
          key,
          workspaceId: ctx.workspaceId,
          columns: {
            create: DEFAULT_COLUMNS.map((column, position) => ({
              ...column,
              position,
            })),
          },
        },
        select: summarySelect,
      });
      await recordActivity(tx, ctx, {
        action: "project.created",
        projectId: project.id,
        data: { name: parsed.name, key },
      });
      return toSummary(project);
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new ServiceError(409, `Key ${key} is already used in this workspace`);
    }
    throw error;
  }
}

/** Rename and/or change mode. The key is immutable (issue keys depend on it). */
export async function updateProject(ctx: Ctx, projectId: string, input: unknown) {
  authorize(ctx, "project.update");
  if (input && typeof input === "object" && "key" in input) {
    throw badRequest("A project's key can't be changed");
  }
  const { name, mode } = updateProjectSchema.parse(input);

  return db.$transaction(async (tx) => {
    const before = await tx.project.findFirst({
      where: { id: projectId, ...projectScope(ctx) },
      select: { name: true, mode: true },
    });
    if (!before) throw notFound("Project not found");
    const project = await tx.project.update({
      where: { id: projectId },
      data: { name, mode },
      select: summarySelect,
    });
    await recordActivity(tx, ctx, {
      action: "project.updated",
      projectId,
      data: {
        ...(name !== undefined && name !== before.name && { name: { from: before.name, to: name } }),
        ...(mode !== undefined && mode !== before.mode && { mode: { from: before.mode, to: mode } }),
      },
    });
    return toSummary(project);
  });
}

/** Delete a project; Prisma cascades remove its columns, issues, and labels. */
export async function deleteProject(ctx: Ctx, projectId: string) {
  authorize(ctx, "project.delete");
  await db.$transaction(async (tx) => {
    const project = await findProjectInWorkspace(tx, ctx, projectId);
    await tx.project.delete({ where: { id: projectId } });
    await recordActivity(tx, ctx, {
      action: "project.deleted",
      projectId,
      data: { name: project.name, key: project.key },
    });
  });
}
