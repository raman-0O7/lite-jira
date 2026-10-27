import { z } from "zod";

export const API_TOKEN_EXPIRY_DAYS = [30, 90, 365] as const;

export const createApiTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
  access: z.enum(["READ", "WRITE"]).default("READ"),
  // Empty → every project the owner can see.
  projectIds: z.array(z.string().min(1)).max(50).default([]),
  // Days until expiry; null → never.
  expiresInDays: z
    .union([z.literal(30), z.literal(90), z.literal(365)])
    .nullable()
    .default(90),
});

export type CreateApiTokenInput = z.input<typeof createApiTokenSchema>;
