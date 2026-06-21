import { z } from "zod";

// Hex color, e.g. #RRGGBB or #RGB.
const hexColor = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Must be a valid hex color");

export const createLabelSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50),
  color: hexColor,
});

export const updateLabelSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(50).optional(),
  color: hexColor.optional(),
});

export type CreateLabelInput = z.infer<typeof createLabelSchema>;
export type UpdateLabelInput = z.infer<typeof updateLabelSchema>;
