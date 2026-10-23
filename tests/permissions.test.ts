import { describe, expect, it } from "vitest";

import { type Action, can } from "@/lib/permissions";
import type { Actor } from "@/lib/services/context";

const user: Actor = { type: "user", userId: "u1" };
const agent: Actor = { type: "agent", agentId: "a1", onBehalfOf: "u1" };

describe("role matrix", () => {
  const cases: [Action, Record<"OWNER" | "ADMIN" | "MEMBER" | "GUEST", boolean>][] = [
    ["board.read", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: true }],
    ["task.write", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: false }],
    ["board.create", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: false }],
    ["board.delete", { OWNER: true, ADMIN: true, MEMBER: false, GUEST: false }],
    ["members.manage", { OWNER: true, ADMIN: true, MEMBER: false, GUEST: false }],
    ["workspace.delete", { OWNER: true, ADMIN: false, MEMBER: false, GUEST: false }],
  ];

  for (const [action, expected] of cases) {
    it(`${action}`, () => {
      for (const [role, allowed] of Object.entries(expected)) {
        expect(can({ actor: user, role: role as keyof typeof expected }, action), role).toBe(allowed);
      }
    });
  }
});

describe("agent cap", () => {
  it("lets an agent do what its user can do day to day", () => {
    expect(can({ actor: agent, role: "MEMBER" }, "task.write")).toBe(true);
    expect(can({ actor: agent, role: "OWNER" }, "board.create")).toBe(true);
  });

  it("never lets an agent delete boards or manage the workspace, even for an owner", () => {
    for (const action of ["board.delete", "members.manage", "integrations.manage", "workspace.delete"] as const) {
      expect(can({ actor: agent, role: "OWNER" }, action), action).toBe(false);
    }
  });

  it("never gives an agent more than its user", () => {
    expect(can({ actor: agent, role: "GUEST" }, "task.write")).toBe(false);
  });
});
