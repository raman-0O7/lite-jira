import { request } from "@/lib/api/http";
import type { PersonStub } from "@/lib/api/projects";

export type IssueComment = {
  id: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  authorAgentId: string | null;
  author: PersonStub | null;
};

export async function fetchComments(issueId: string) {
  const data = await request<{ comments: IssueComment[] }>(
    `/api/issues/${issueId}/comments`,
    "Failed to load comments",
  );
  return data.comments;
}

export async function addComment(issueId: string, body: string) {
  const data = await request<{ comment: IssueComment }>(
    `/api/issues/${issueId}/comments`,
    "Failed to add comment",
    { method: "POST", body: { body } },
  );
  return data.comment;
}

export async function deleteComment(id: string) {
  await request(`/api/comments/${id}`, "Failed to delete comment", { method: "DELETE" });
}
