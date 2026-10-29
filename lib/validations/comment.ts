import { z } from "zod";

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty").max(10_000),
});

/** With images attached, the text can be empty. */
export const commentWithImagesSchema = z.object({
  body: z.string().trim().max(10_000).default(""),
});

export type CommentInput = z.infer<typeof commentSchema>;
