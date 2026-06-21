import { z } from "zod";

export const createColumnSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

export const updateColumnSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
});

export const reorderColumnsSchema = z.object({
  boardId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
});

export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type ReorderColumnsInput = z.infer<typeof reorderColumnsSchema>;
