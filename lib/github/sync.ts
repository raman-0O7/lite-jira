import type { ColumnCategory } from "@prisma/client";

import { db } from "@/lib/db";
import { defer } from "@/lib/defer";
import { setIssueState } from "@/lib/github/client";
import type { Ctx } from "@/lib/services/context";

/**
 * Kanso → GitHub status sync (docs/features/11-github-app.md "Status sync").
 * Called by moveIssue when an issue crosses into or out of DONE. Runs after
 * the response; a GitHub failure is logged and never undoes the move.
 */
export function onCategoryChange(ctx: Ctx, issueId: string, from: ColumnCategory, to: ColumnCategory) {
  // The sync's own moves came from GitHub; don't echo them back.
  if (ctx.via === "github") return;
  const nowDone = to === "DONE";
  if ((from === "DONE") === nowDone) return;
  defer("github.status", () => pushIssueState(issueId, nowDone ? "closed" : "open"));
}

export async function pushIssueState(issueId: string, state: "open" | "closed") {
  const link = await db.gitHubIssueLink.findUnique({
    where: { issueId },
    select: {
      id: true,
      repoFullName: true,
      number: true,
      state: true,
      projectRepo: {
        select: { statusSync: true, installation: { select: { installationId: true, suspendedAt: true } } },
      },
    },
  });
  const repo = link?.projectRepo;
  if (!link || !repo?.statusSync || repo.installation.suspendedAt) return;
  const wanted = state === "closed" ? "CLOSED" : "OPEN";
  if (link.state === wanted) return;
  await setIssueState(repo.installation.installationId, link.repoFullName, link.number, state);
  await db.gitHubIssueLink.update({ where: { id: link.id }, data: { state: wanted, lastSyncedAt: new Date() } });
}
