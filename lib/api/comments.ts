import { parseError, request } from "@/lib/api/http";
import type { AgentStub, PersonStub } from "@/lib/api/projects";

export type IssueComment = {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  authorAgentId: string | null;
  author: PersonStub | null;
  /** Set when an agent wrote it (on behalf of `author`, its owner). */
  authorAgent?: AgentStub | null;
  attachments?: CommentAttachment[];
};

export type CommentAttachment = { id: string; name: string; contentType: string; size: number };

/** Mirrors lib/attachments.ts (checked again on the server). */
export const ATTACHMENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;

export const attachmentUrl = (id: string) => `/api/attachments/${id}`;

export async function fetchComments(issueId: string) {
  const data = await request<{ comments: IssueComment[] }>(
    `/api/issues/${issueId}/comments`,
    "Failed to load comments",
  );
  return data.comments;
}

export async function addComment(issueId: string, body: string, images: File[] = []) {
  if (!images.length) {
    const data = await request<{ comment: IssueComment }>(
      `/api/issues/${issueId}/comments`,
      "Failed to add comment",
      { method: "POST", body: { body } },
    );
    return data.comment;
  }
  const form = new FormData();
  form.set("body", body);
  for (const image of images) form.append("image", image);
  const res = await fetch(`/api/issues/${issueId}/comments`, { method: "POST", body: form });
  if (!res.ok) await parseError(res, "Failed to add comment");
  return ((await res.json()) as { comment: IssueComment }).comment;
}

export async function deleteComment(id: string) {
  await request(`/api/comments/${id}`, "Failed to delete comment", { method: "DELETE" });
}
