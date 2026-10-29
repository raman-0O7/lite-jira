import type { UploadedImage } from "@/lib/attachments";
import { resumeRun } from "@/lib/agents/resume";
import { db } from "@/lib/db";
import { defer } from "@/lib/defer";
import { authorize, can } from "@/lib/permissions";
import { recordActivity } from "@/lib/services/activity";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { forbidden, notFound } from "@/lib/services/errors";
import { projectScope } from "@/lib/services/scope";
import { commentSchema, commentWithImagesSchema } from "@/lib/validations/comment";

const commentSelect = {
  id: true,
  body: true,
  createdAt: true,
  editedAt: true,
  authorAgentId: true,
  author: { select: { id: true, name: true, image: true } },
  authorAgent: { select: { id: true, name: true, kind: true } },
  attachments: {
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, contentType: true, size: true },
  },
} as const;

async function findIssue(ctx: Ctx, issueId: string) {
  const issue = await db.issue.findFirst({
    where: { id: issueId, project: projectScope(ctx) },
    select: { id: true, projectId: true },
  });
  if (!issue) throw notFound("Issue not found");
  return issue;
}

async function findComment(ctx: Ctx, commentId: string) {
  const comment = await db.comment.findFirst({
    where: { id: commentId, issue: { project: projectScope(ctx) } },
    select: {
      id: true,
      authorUserId: true,
      authorAgentId: true,
      issueId: true,
      issue: { select: { projectId: true } },
    },
  });
  if (!comment) throw notFound("Comment not found");
  return comment;
}

/** Whether the ctx actor wrote this comment (agents match on their own id). */
function isAuthor(
  ctx: Ctx,
  comment: { authorUserId: string | null; authorAgentId: string | null },
) {
  if (ctx.actor.type === "agent") return comment.authorAgentId === ctx.actor.agentId;
  if (ctx.actor.type === "user") {
    return comment.authorAgentId === null && comment.authorUserId === ctx.actor.userId;
  }
  return false;
}

export async function listComments(ctx: Ctx, issueId: string) {
  authorize(ctx, "project.read");
  await findIssue(ctx, issueId);
  return db.comment.findMany({
    where: { issueId },
    orderBy: { createdAt: "asc" },
    select: commentSelect,
  });
}

/**
 * Add a comment, optionally with images (already validated by readImages). A
 * teammate's comment while an MCP agent waits for input is sent to it.
 */
export async function addComment(ctx: Ctx, issueId: string, input: unknown, images: UploadedImage[] = []) {
  authorize(ctx, "comment.write");
  const { body } = images.length ? commentWithImagesSchema.parse(input) : commentSchema.parse(input);
  const issue = await findIssue(ctx, issueId);

  const comment = await db.$transaction(async (tx) => {
    const created = await tx.comment.create({
      data: {
        issueId,
        body,
        authorUserId: actingUserId(ctx),
        authorAgentId: ctx.actor.type === "agent" ? ctx.actor.agentId : null,
        attachments: {
          create: images.map((image) => ({
            name: image.name,
            contentType: image.contentType,
            size: image.data.length,
            data: new Uint8Array(image.data),
          })),
        },
      },
      select: commentSelect,
    });
    await recordActivity(tx, ctx, {
      action: "comment.added",
      projectId: issue.projectId,
      issueId,
      data: { commentId: created.id },
    });
    return created;
  });

  if (ctx.actor.type === "user" && can(ctx, "agent.dispatch")) {
    // Claude Code is answered in its own session (the run's sessionUrl), not here.
    const waiting = await db.agentRun.findFirst({
      where: { issueId, status: "NEEDS_INPUT", agent: { kind: "MCP" } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (waiting) defer("agents.resume", () => resumeRun(ctx, waiting.id, comment.id));
  }
  return comment;
}

/** An image attached to a comment the caller can see. */
export async function getAttachment(ctx: Ctx, attachmentId: string) {
  authorize(ctx, "project.read");
  const attachment = await db.attachment.findFirst({
    where: { id: attachmentId, comment: { issue: { project: projectScope(ctx) } } },
    select: { id: true, name: true, contentType: true, size: true, data: true },
  });
  if (!attachment) throw notFound("Attachment not found");
  return attachment;
}

/** Only the author can edit their comment. */
export async function editComment(ctx: Ctx, commentId: string, input: unknown) {
  authorize(ctx, "comment.write");
  const { body } = commentSchema.parse(input);
  const comment = await findComment(ctx, commentId);
  if (!isAuthor(ctx, comment)) throw forbidden("Only the author can edit a comment");

  return db.$transaction(async (tx) => {
    const updated = await tx.comment.update({
      where: { id: commentId },
      data: { body, editedAt: new Date() },
      select: commentSelect,
    });
    await recordActivity(tx, ctx, {
      action: "comment.edited",
      projectId: comment.issue.projectId,
      issueId: comment.issueId,
      data: { commentId },
    });
    return updated;
  });
}

/** The author, or an owner/admin moderating, can delete a comment. */
export async function deleteComment(ctx: Ctx, commentId: string) {
  authorize(ctx, "comment.write");
  const comment = await findComment(ctx, commentId);
  if (!isAuthor(ctx, comment) && !can(ctx, "comment.moderate")) {
    throw forbidden("Only the author or an admin can delete a comment");
  }

  await db.$transaction(async (tx) => {
    await tx.comment.delete({ where: { id: commentId } });
    await recordActivity(tx, ctx, {
      action: "comment.deleted",
      projectId: comment.issue.projectId,
      issueId: comment.issueId,
      data: { commentId },
    });
  });
}
