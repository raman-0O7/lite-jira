import { afterAll, afterEach, beforeEach } from "vitest";

import { db } from "@/lib/db";
import { flushDeferred } from "@/lib/defer";

// Every test starts from an empty database.
beforeEach(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE "Activity", "Invite", "ProjectAccess", "Comment", "IssueLink", "Label", "Issue", "Sprint", "Column", "Project", "Membership", "Workspace", "Session", "Account", "Verification", "User", "GitHubDelivery" CASCADE`,
  );
});

// Run work a test deferred (GitHub calls, agent dispatch) before the next
// test truncates the database under it.
afterEach(async () => {
  await flushDeferred();
});

afterAll(async () => {
  await db.$disconnect();
});
