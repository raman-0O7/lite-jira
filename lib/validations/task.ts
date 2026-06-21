import { z } from "zod";

export const priorityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]);

export const createTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200),
  description: z.string().max(10_000).nullish(),
  priority: priorityEnum.default("MEDIUM"),
  dueDate: z.coerce.date().nullish(),
  labelIds: z.array(z.string().min(1)).optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200).optional(),
  description: z.string().max(10_000).nullish(),
  priority: priorityEnum.optional(),
  dueDate: z.coerce.date().nullish(),
  labelIds: z.array(z.string().min(1)).optional(),
});

export const moveTaskSchema = z.object({
  taskId: z.string().min(1),
  toColumnId: z.string().min(1),
  toPosition: z.number().int().min(0),
});

export type Priority = z.infer<typeof priorityEnum>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
