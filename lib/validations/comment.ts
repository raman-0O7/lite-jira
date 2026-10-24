import { z } from "zod";

export const commentSchema = z.object({
  body: z.string().trim().min(1, "Comment can't be empty").max(10_000),
});

export type CommentInput = z.infer<typeof commentSchema>;
