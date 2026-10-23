import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

describe("signup", () => {
  it("creates a personal workspace for every new account", async () => {
    await auth.api.signUpEmail({
      body: { name: "New Person", email: "new@example.test", password: "correct-horse-battery" },
    });
    const user = await db.user.findUniqueOrThrow({ where: { email: "new@example.test" } });
    const memberships = await db.membership.findMany({
      where: { userId: user.id },
      include: { workspace: true },
    });
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: "OWNER", workspace: { personal: true, name: "New Person" } });
  });
});
