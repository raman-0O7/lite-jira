import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { userCtx } from "@/lib/services/context";
import { slugify } from "@/lib/slug";
import {
  createWorkspace,
  defaultWorkspaceSlug,
  deleteWorkspace,
  ensurePersonalWorkspace,
  findMembershipBySlug,
  updateWorkspace,
} from "@/lib/services/workspaces";
import { addMember, makeUser } from "@/tests/factories";

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

describe("team workspaces", () => {
  it("creates a workspace owned by the creator, with a derived or chosen slug", async () => {
    const user = await makeUser("Ada");
    const derived = await createWorkspace(user.id, { name: "Acme Studio" });
    expect(derived).toMatchObject({ slug: "acme-studio", personal: false, role: "OWNER" });
    const chosen = await createWorkspace(user.id, { name: "Client", slug: "Client-X" });
    expect(chosen.slug).toBe("client-x");
    // The derived slug moves aside when taken; an explicit one is a conflict.
    const again = await createWorkspace(user.id, { name: "Acme Studio" });
    expect(again.slug).toMatch(/^acme-studio-[0-9a-f]{6}$/);
    await expect(createWorkspace(user.id, { name: "X", slug: "client-x" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(createWorkspace(user.id, { name: "X", slug: "settings" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(createWorkspace(user.id, { name: "X", slug: "a" })).rejects.toThrow();
    expect(await db.activity.count({ where: { action: "workspace.created" } })).toBe(3);
  });

  it("renames for owners and admins, deletes for owners only, never a personal one", async () => {
    const owner = await makeUser("Owner");
    const workspace = await createWorkspace(owner.id, { name: "Acme" });
    const ctx = userCtx(owner.id, workspace.id, "OWNER");
    const admin = await addMember(workspace.id, await makeUser("Admin"), "ADMIN");

    expect((await updateWorkspace(admin, { name: "Acme Inc" })).name).toBe("Acme Inc");
    await expect(deleteWorkspace(admin)).rejects.toMatchObject({ status: 403 });
    await deleteWorkspace(ctx);
    expect(await db.workspace.count({ where: { id: workspace.id } })).toBe(0);

    const personal = await ensurePersonalWorkspace(owner);
    await expect(deleteWorkspace(userCtx(owner.id, personal.id, "OWNER"))).rejects.toMatchObject({
      status: 400,
    });
  });
});
