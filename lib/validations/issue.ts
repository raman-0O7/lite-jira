import { z } from "zod";

export const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);
export const issueTypeEnum = z.enum(["EPIC", "STORY", "TASK", "BUG", "SUBTASK"]);

const title = z.string().trim().min(1, "Title is required").max(200);
const id = z.string().min(1);

export const createIssueSchema = z.object({
  title,
  // Sub-issues are created through createSubIssueSchema, never by type.
  type: issueTypeEnum.exclude(["SUBTASK"]).default("TASK"),
});

export const createSubIssueSchema = z.object({ title });

export const updateIssueSchema = z.object({
  title: title.optional(),
  description: z.string().max(10_000).nullish(),
  acceptanceCriteria: z.string().max(10_000).nullish(),
  priority: priorityEnum.optional(),
  type: issueTypeEnum.optional(),
  dueDate: z.coerce.date().nullish(),
  estimate: z.number().int().min(0).max(100).nullish(),
  labelIds: z.array(id).optional(),
  assigneeUserId: id.nullish(),
  epicId: id.nullish(),
});

export const moveIssueSchema = z.object({
  issueId: id,
  toColumnId: id,
  toPosition: z.number().int().min(0),
});

export type Priority = z.infer<typeof priorityEnum>;
export type IssueType = z.infer<typeof issueTypeEnum>;
export type CreateIssueInput = z.infer<typeof createIssueSchema>;
export type UpdateIssueInput = z.infer<typeof updateIssueSchema>;
export type MoveIssueInput = z.infer<typeof moveIssueSchema>;
