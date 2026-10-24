import { afterAll, beforeEach } from "vitest";

import { db } from "@/lib/db";

// Every test starts from an empty database.
beforeEach(async () => {
  await db.$executeRawUnsafe(
    `TRUNCATE "Activity", "Comment", "IssueLink", "Label", "Issue", "Sprint", "Column", "Project", "Membership", "Workspace", "Session", "Account", "Verification", "User" CASCADE`,
  );
});

afterAll(async () => {
  await db.$disconnect();
});
