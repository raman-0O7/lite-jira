import { describe, expect, it } from "vitest";

import { type Action, can } from "@/lib/permissions";
import type { Actor } from "@/lib/services/context";

const user: Actor = { type: "user", userId: "u1" };
const agent: Actor = { type: "agent", agentId: "a1", onBehalfOf: "u1" };

describe("role matrix", () => {
  const cases: [Action, Record<"OWNER" | "ADMIN" | "MEMBER" | "GUEST", boolean>][] = [
    ["project.read", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: true }],
    ["comment.write", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: true }],
    ["issue.write", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: false }],
    ["project.create", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: false }],
    ["project.delete", { OWNER: true, ADMIN: true, MEMBER: false, GUEST: false }],
    ["comment.moderate", { OWNER: true, ADMIN: true, MEMBER: false, GUEST: false }],
    ["members.manage", { OWNER: true, ADMIN: true, MEMBER: false, GUEST: false }],
    ["agent.create", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: false }],
    ["agent.manage", { OWNER: true, ADMIN: true, MEMBER: false, GUEST: false }],
    ["agent.dispatch", { OWNER: true, ADMIN: true, MEMBER: true, GUEST: false }],
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
    expect(can({ actor: agent, role: "MEMBER" }, "issue.write")).toBe(true);
    expect(can({ actor: agent, role: "OWNER" }, "project.create")).toBe(true);
    expect(can({ actor: agent, role: "MEMBER" }, "comment.write")).toBe(true);
  });

  it("never lets an agent delete projects, moderate, or manage the workspace, even for an owner", () => {
    for (const action of [
      "project.delete",
      "comment.moderate",
      "members.manage",
      "integrations.manage",
      "agent.create",
      "agent.manage",
      "agent.dispatch",
      "workspace.delete",
    ] as const) {
      expect(can({ actor: agent, role: "OWNER" }, action), action).toBe(false);
    }
  });

  it("never gives an agent more than its user", () => {
    expect(can({ actor: agent, role: "GUEST" }, "issue.write")).toBe(false);
  });
});

describe("credential limits (tokens)", () => {
  const readOnly = { write: false, projectIds: null };
  const writer = { write: true, projectIds: null };
  const limited = { write: true, projectIds: ["p1"] };

  it("lets read-only credentials read and nothing else", () => {
    expect(can({ actor: user, role: "OWNER", limits: readOnly }, "project.read")).toBe(true);
    expect(can({ actor: user, role: "OWNER", limits: readOnly }, "workspace.read")).toBe(true);
    for (const action of ["issue.write", "comment.write", "project.create"] as const) {
      expect(can({ actor: user, role: "OWNER", limits: readOnly }, action), action).toBe(false);
    }
  });

  it("never exceeds the role and never does what agents may not", () => {
    expect(can({ actor: user, role: "GUEST", limits: writer }, "issue.write")).toBe(false);
    expect(can({ actor: user, role: "GUEST", limits: writer }, "comment.write")).toBe(true);
    expect(can({ actor: user, role: "MEMBER", limits: writer }, "issue.write")).toBe(true);
    for (const action of ["project.delete", "members.manage", "workspace.delete", "token.manage"] as const) {
      expect(can({ actor: user, role: "OWNER", limits: writer }, action), action).toBe(false);
    }
  });

  it("forbids creating projects with a project-limited credential", () => {
    expect(can({ actor: user, role: "OWNER", limits: limited }, "project.create")).toBe(false);
    expect(can({ actor: user, role: "OWNER", limits: limited }, "issue.write")).toBe(true);
  });

  it("lets every role manage its own tokens from the web", () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "GUEST"] as const) {
      expect(can({ actor: user, role }, "token.manage"), role).toBe(true);
    }
  });
});
