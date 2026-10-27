import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { db } from "@/lib/db";
import {
  createApiToken,
  ctxForApiToken,
  hashApiToken,
  listApiTokens,
  revokeApiToken,
} from "@/lib/services/api-tokens";
import { createProject } from "@/lib/services/projects";
import { addMember, makeTeam, makeUser, shareProject } from "@/tests/factories";
import { expectStatus, makeProject } from "@/tests/helpers";

describe("API tokens", () => {
  it("returns the secret once and stores only its hash", async () => {
    const { ctx } = await makeTeam();
    const { token, secret } = await createApiToken(ctx, { name: "CI" });
    expect(secret).toMatch(/^kanso_[0-9A-Za-z]{40}$/);
    expect(token).toMatchObject({ name: "CI", access: "READ", prefix: secret.slice(0, 12), expired: false });
    expect(token).not.toHaveProperty("tokenHash");
    const row = await db.apiToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(row.tokenHash).toBe(hashApiToken(secret));
    expect(JSON.stringify(row)).not.toContain(secret);
    // Default expiry is 90 days.
    const days = (row.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
    const activity = await db.activity.findMany({ where: { workspaceId: ctx.workspaceId, action: "api_token.created" } });
    expect(activity).toHaveLength(1);
    expect(JSON.stringify(activity[0]!.data)).not.toContain(secret);
  });

  it("lists and revokes only your own tokens", async () => {
    const owner = await makeTeam();
    const member = await addMember(owner.workspace.id, await makeUser("Mo"), "MEMBER");
    const mine = await createApiToken(owner.ctx, { name: "Mine" });
    const theirs = await createApiToken(member, { name: "Theirs", expiresInDays: null });
    expect((await listApiTokens(owner.ctx)).map((t) => t.name)).toEqual(["Mine"]);
    expect((await listApiTokens(member))[0]).toMatchObject({ name: "Theirs", expiresAt: null });

    await expectStatus(revokeApiToken(owner.ctx, theirs.token.id), 404);
    await revokeApiToken(owner.ctx, mine.token.id);
    await expectStatus(revokeApiToken(owner.ctx, mine.token.id), 404);
    expect(await listApiTokens(owner.ctx)).toEqual([]);
  });

  it("allows at most 20 active tokens per person and workspace", async () => {
    const { ctx } = await makeTeam();
    for (let i = 0; i < 20; i++) await createApiToken(ctx, { name: `t${i}` });
    await expectStatus(createApiToken(ctx, { name: "one too many" }), 409);
    const [first] = await listApiTokens(ctx);
    await revokeApiToken(ctx, first!.id);
    await createApiToken(ctx, { name: "after revoke" });
  });

  it("validates input and project limits against what the creator can see", async () => {
    const owner = await makeTeam();
    const shared = await makeProject(owner.ctx, "Shared", "SHR");
    const hidden = await makeProject(owner.ctx, "Hidden", "HID");
    const guestUser = await makeUser("Guest");
    const guest = await addMember(owner.workspace.id, guestUser, "GUEST");
    await shareProject(owner.workspace.id, guestUser.id, shared.project.id);

    await expect(createApiToken(owner.ctx, { name: "" })).rejects.toThrow(ZodError);
    await expect(createApiToken(owner.ctx, { name: "x", expiresInDays: 7 })).rejects.toThrow(ZodError);
    await expectStatus(createApiToken(owner.ctx, { name: "x", projectIds: ["nope"] }), 400);
    await expectStatus(createApiToken(guest, { name: "x", projectIds: [hidden.project.id] }), 400);
    const { token } = await createApiToken(guest, { name: "Guest token", projectIds: [shared.project.id] });
    expect(token.projectIds).toEqual([shared.project.id]);
  });

  it("can't be managed with a token", async () => {
    const { ctx } = await makeTeam();
    const { secret } = await createApiToken(ctx, { name: "w", access: "WRITE" });
    const tokenCtx = (await ctxForApiToken(secret))!;
    await expectStatus(createApiToken(tokenCtx, { name: "child" }), 403);
    await expectStatus(listApiTokens(tokenCtx), 403);
  });
});

describe("ctxForApiToken", () => {
  it("resolves a valid secret to the owner's current role, capped by the token", async () => {
    const owner = await makeTeam();
    const user = await makeUser("Mo");
    const member = await addMember(owner.workspace.id, user, "MEMBER");
    const project = await createProject(owner.ctx, { name: "Web", key: "WEB" });
    const { secret, token } = await createApiToken(member, {
      name: "w",
      access: "WRITE",
      projectIds: [project.id],
    });

    const ctx = await ctxForApiToken(secret);
    expect(ctx).toMatchObject({
      actor: { type: "user", userId: user.id },
      workspaceId: owner.workspace.id,
      role: "MEMBER",
      via: "api_token",
      limits: { write: true, projectIds: [project.id] },
    });
    expect((await db.apiToken.findUniqueOrThrow({ where: { id: token.id } })).lastUsedAt).not.toBeNull();

    // A demotion applies to existing tokens at once.
    await db.membership.update({
      where: { workspaceId_userId: { workspaceId: owner.workspace.id, userId: user.id } },
      data: { role: "GUEST" },
    });
    expect((await ctxForApiToken(secret))?.role).toBe("GUEST");
  });

  it("rejects unknown, revoked, and expired tokens, and tokens of removed members", async () => {
    const owner = await makeTeam();
    const user = await makeUser("Mo");
    const member = await addMember(owner.workspace.id, user, "MEMBER");

    expect(await ctxForApiToken("kanso_doesnotexist")).toBeNull();

    const revoked = await createApiToken(member, { name: "r" });
    await revokeApiToken(member, revoked.token.id);
    expect(await ctxForApiToken(revoked.secret)).toBeNull();

    const expired = await createApiToken(member, { name: "e", expiresInDays: 30 });
    await db.apiToken.update({ where: { id: expired.token.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await ctxForApiToken(expired.secret)).toBeNull();
    expect((await listApiTokens(member)).find((t) => t.name === "e")?.expired).toBe(true);

    const left = await createApiToken(member, { name: "l" });
    expect(await ctxForApiToken(left.secret)).not.toBeNull();
    await db.membership.delete({
      where: { workspaceId_userId: { workspaceId: owner.workspace.id, userId: user.id } },
    });
    expect(await ctxForApiToken(left.secret)).toBeNull();
  });

  it("gives read tokens no write access and unlimited tokens every project", async () => {
    const { ctx } = await makeTeam();
    const { secret } = await createApiToken(ctx, { name: "r" });
    expect((await ctxForApiToken(secret))?.limits).toEqual({ write: false, projectIds: null });
  });
});
