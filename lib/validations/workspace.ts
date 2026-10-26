import { z } from "zod";

const name = z.string().trim().min(1, "Name is required").max(60);

/** Workspace URL slug: 3–40 characters, a–z, 0–9 and inner hyphens. */
export const workspaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/,
    "URL must be 3–40 lowercase letters, digits, or hyphens",
  );

export const createWorkspaceSchema = z.object({
  name,
  // Omitted → derived from the name.
  slug: workspaceSlugSchema.optional(),
});

export const updateWorkspaceSchema = z.object({ name });

const role = z.enum(["OWNER", "ADMIN", "MEMBER", "GUEST"]);

export const updateMemberSchema = z.object({ role });

export const memberProjectsSchema = z.object({
  projectIds: z.array(z.string().min(1)).max(200),
});

export const createInviteSchema = z
  .object({
    // Empty or omitted → a link invite anyone can accept once.
    email: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((v) => v || null)
      .pipe(z.email("Enter a valid email").max(254).nullable()),
    role: z.enum(["ADMIN", "MEMBER", "GUEST"]),
    projectIds: z.array(z.string().min(1)).max(200).default([]),
  })
  .refine((v) => v.role === "GUEST" || v.projectIds.length === 0, {
    message: "Only guest invites list projects",
    path: ["projectIds"],
  });

export const acceptInviteSchema = z.object({ token: z.string().min(1).max(200) });

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type CreateInviteInput = z.input<typeof createInviteSchema>;
