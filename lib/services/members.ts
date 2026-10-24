import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import type { Ctx } from "@/lib/services/context";

/** Workspace members, for assignee pickers and @mentions. */
export async function listMembers(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  const memberships = await db.membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      user: { select: { id: true, name: true, email: true, image: true } },
    },
  });
  return memberships.map((m) => ({ ...m.user, role: m.role }));
}
