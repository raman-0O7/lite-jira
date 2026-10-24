import { z } from "zod";

const name = z.string().trim().min(1, "Name is required").max(100);
export const columnCategoryEnum = z.enum(["TODO", "IN_PROGRESS", "DONE"]);

export const createColumnSchema = z.object({
  name,
  category: columnCategoryEnum.optional(),
});

export const updateColumnSchema = z
  .object({
    name: name.optional(),
    category: columnCategoryEnum.optional(),
  })
  .refine((v) => v.name !== undefined || v.category !== undefined, {
    message: "Nothing to update",
  });

export const reorderColumnsSchema = z.object({
  projectId: z.string().min(1),
  orderedIds: z.array(z.string().min(1)).min(1),
});

export type ColumnCategory = z.infer<typeof columnCategoryEnum>;
export type CreateColumnInput = z.infer<typeof createColumnSchema>;
export type UpdateColumnInput = z.infer<typeof updateColumnSchema>;
export type ReorderColumnsInput = z.infer<typeof reorderColumnsSchema>;
