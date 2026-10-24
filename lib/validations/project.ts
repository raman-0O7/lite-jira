import { z } from "zod";

const name = z.string().trim().min(1, "Name is required").max(100);

/** Issue key prefix: 2–10 characters, A–Z and 0–9, starting with a letter. */
export const projectKeySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z][A-Z0-9]{1,9}$/,
    "Key must be 2–10 letters or digits and start with a letter",
  );

export const createProjectSchema = z.object({
  name,
  // Omitted → suggested from the name.
  key: projectKeySchema.optional(),
});

export const updateProjectSchema = z
  .object({
    name: name.optional(),
    mode: z.enum(["KANBAN", "SCRUM"]).optional(),
  })
  .refine((v) => v.name !== undefined || v.mode !== undefined, {
    message: "Nothing to update",
  });

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
