import { db } from "@/lib/db";

/**
 * Whether a user runs this Kanso server: listed in OWNER_EMAILS, or, when
 * that's unset, the first account ever created (whoever deployed it). Only
 * they do server-wide setup, such as creating the GitHub App.
 */
export async function isServerOwner(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const emails = (process.env.OWNER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (emails.length) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { email: true } });
    return Boolean(user && emails.includes(user.email.toLowerCase()));
  }
  const first = await db.user.findFirst({ orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true } });
  return first?.id === userId;
}
