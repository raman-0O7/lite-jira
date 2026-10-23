import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  defaultWorkspaceSlug,
  ensurePersonalWorkspace,
  findMembershipBySlug,
  slugify,
} from "@/lib/services/workspaces";
import { makeUser } from "@/tests/factories";

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("  Acme Studio!! ")).toBe("acme-studio");
  });
  it("falls back when nothing usable is left", () => {
    expect(slugify("✨✨")).toBe("workspace");
  });
  it("caps length without a trailing dash", () => {
    const slug = slugify("a".repeat(39) + " bcdef");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("ensurePersonalWorkspace", () => {
  it("creates one personal workspace with an OWNER membership", async () => {
    const user = await makeUser("Grace Hopper");
    const ws = await ensurePersonalWorkspace(user);

    const membership = await findMembershipBySlug(user.id, ws.slug);
    expect(membership).toMatchObject({ personal: true, role: "OWNER", name: "Grace Hopper" });
    expect(ws.slug).toMatch(/^grace-hopper-[0-9a-f]{6}$/);
  });

  it("is idempotent", async () => {
    const user = await makeUser();
    const first = await ensurePersonalWorkspace(user);
    const second = await ensurePersonalWorkspace(user);
    expect(second.id).toBe(first.id);
    expect(await db.workspace.count()).toBe(1);
  });

  it("gives users with the same name different slugs", async () => {
    const a = await ensurePersonalWorkspace(await makeUser("Sam"));
    const b = await ensurePersonalWorkspace(await makeUser("Sam"));
    expect(a.slug).not.toBe(b.slug);
  });
});

describe("defaultWorkspaceSlug", () => {
  it("creates the personal workspace for a user who has none", async () => {
    const user = await makeUser("Linus");
    const slug = await defaultWorkspaceSlug(user);
    expect(await findMembershipBySlug(user.id, slug)).toMatchObject({ personal: true });
  });

  it("prefers the personal workspace over shared ones", async () => {
    const user = await makeUser();
    await db.workspace.create({
      data: { name: "Team", slug: "team", memberships: { create: { userId: user.id, role: "MEMBER" } } },
    });
    const personal = await ensurePersonalWorkspace(user);
    expect(await defaultWorkspaceSlug(user)).toBe(personal.slug);
  });
});

describe("findMembershipBySlug", () => {
  it("returns null for a workspace the user does not belong to", async () => {
    const other = await ensurePersonalWorkspace(await makeUser("Other"));
    const user = await makeUser();
    expect(await findMembershipBySlug(user.id, other.slug)).toBeNull();
  });
});
