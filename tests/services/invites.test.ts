import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import {
  acceptInvite,
  createInvite,
  getInvitePreview,
  listInvites,
  renewInvite,
  revokeInvite,
} from "@/lib/services/invites";
import { listProjects } from "@/lib/services/projects";
import { userCtx } from "@/lib/services/context";
import { addMember, makeOwner, makeTeam, makeUser } from "@/tests/factories";
import { expectStatus, makeProject } from "@/tests/helpers";

const tokenOf = (url: string) => url.split("/invite/")[1]!;

describe("creating invites", () => {
  it("stores only a hash and returns a working link", async () => {
    const { ctx, workspace } = await makeTeam();
    const { invite, url, emailSent } = await createInvite(ctx, {
      email: " New@Example.test ",
      role: "MEMBER",
    });
    expect(invite.email).toBe("new@example.test");
    expect(emailSent).toBe(false);
    const row = await db.invite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(row.tokenHash).not.toContain(tokenOf(url));

    const preview = await getInvitePreview(tokenOf(url));
    expect(preview).toMatchObject({
      status: "valid",
      role: "MEMBER",
      workspace: { slug: workspace.slug },
      invitedBy: "Owner",
    });
    expect(await getInvitePreview("nope")).toBeNull();
    expect(await db.activity.count({ where: { action: "invite.created" } })).toBe(1);
  });

  it("refuses personal workspaces, members, guests, duplicates, and admin invites by admins", async () => {
    const solo = await makeOwner();
    await expectStatus(createInvite(solo.ctx, { role: "MEMBER" }), 400);

    const { ctx, workspace } = await makeTeam();
    const admin = await addMember(workspace.id, await makeUser("Admin"), "ADMIN");
    const memberUser = await makeUser("Member");
    const member = await addMember(workspace.id, memberUser, "MEMBER");

    await expectStatus(createInvite(member, { role: "MEMBER" }), 403);
    await expectStatus(createInvite(admin, { role: "ADMIN" }), 403);
    await expectStatus(createInvite(ctx, { email: memberUser.email.toUpperCase(), role: "MEMBER" }), 409);
    await createInvite(ctx, { email: "a@example.test", role: "MEMBER" });
    await expectStatus(createInvite(ctx, { email: "a@example.test", role: "GUEST" }), 409);
  });

  it("only lets guest invites list projects, and only this workspace's", async () => {
    const { ctx } = await makeTeam();
    const { project } = await makeProject(ctx);
    const other = await makeOwner("Other");
    const foreign = await makeProject(other.ctx);

    await expect(createInvite(ctx, { role: "MEMBER", projectIds: [project.id] })).rejects.toThrow();
    await expectStatus(createInvite(ctx, { role: "GUEST", projectIds: [foreign.project.id] }), 400);
    const { invite } = await createInvite(ctx, { role: "GUEST", projectIds: [project.id] });
    expect(invite.projectIds).toEqual([project.id]);
  });
});

describe("accepting invites", () => {
  it("joins with the invited role and is single-use", async () => {
    const { ctx, workspace } = await makeTeam();
    const { url } = await createInvite(ctx, { role: "MEMBER" });
    const alice = await makeUser("Alice");
    const bob = await makeUser("Bob");

    expect(await acceptInvite(alice, { token: tokenOf(url) })).toEqual({ slug: workspace.slug });
    const membership = await db.membership.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId: alice.id } },
    });
    expect(membership?.role).toBe("MEMBER");
    expect(await db.activity.count({ where: { action: "member.joined", actorUserId: alice.id } })).toBe(1);

    await expectStatus(acceptInvite(bob, { token: tokenOf(url) }), 400);
    expect((await getInvitePreview(tokenOf(url)))?.status).toBe("used");
    expect(await listInvites(ctx)).toHaveLength(0);
  });

  it("lets only one of two simultaneous accepts win", async () => {
    const { ctx, workspace } = await makeTeam();
    const { url } = await createInvite(ctx, { role: "MEMBER" });
    const people = await Promise.all([makeUser("A"), makeUser("B"), makeUser("C")]);
    const results = await Promise.allSettled(
      people.map((p) => acceptInvite(p, { token: tokenOf(url) })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.membership.count({ where: { workspaceId: workspace.id } })).toBe(2);
  });

  it("only accepts an email invite for that email", async () => {
    const { ctx, workspace } = await makeTeam();
    const invitee = await makeUser("Invitee");
    const { url } = await createInvite(ctx, { email: invitee.email, role: "MEMBER" });
    await expectStatus(acceptInvite(await makeUser("Someone"), { token: tokenOf(url) }), 403);
    await acceptInvite({ ...invitee, email: invitee.email.toUpperCase() }, { token: tokenOf(url) });
    expect(await db.membership.count({ where: { workspaceId: workspace.id } })).toBe(2);
  });

  it("refuses expired and revoked invites", async () => {
    const { ctx } = await makeTeam();
    const user = await makeUser();
    const expired = await createInvite(ctx, { role: "MEMBER" });
    await db.invite.update({
      where: { id: expired.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expectStatus(acceptInvite(user, { token: tokenOf(expired.url) }), 400);
    expect((await listInvites(ctx))[0]?.expired).toBe(true);

    const revoked = await createInvite(ctx, { role: "MEMBER" });
    await revokeInvite(ctx, revoked.invite.id);
    await expectStatus(acceptInvite(user, { token: tokenOf(revoked.url) }), 400);
    await expectStatus(revokeInvite(ctx, revoked.invite.id), 404);
    await expectStatus(acceptInvite(user, { token: "made-up" }), 404);
  });

  it("sends existing members on without using the invite", async () => {
    const { ctx, workspace } = await makeTeam();
    const memberUser = await makeUser("Member");
    await addMember(workspace.id, memberUser, "MEMBER");
    const { url } = await createInvite(ctx, { role: "GUEST" });
    expect(await acceptInvite(memberUser, { token: tokenOf(url) })).toEqual({ slug: workspace.slug });
    expect((await getInvitePreview(tokenOf(url)))?.status).toBe("valid");
  });

  it("gives an accepted guest exactly the invited projects", async () => {
    const { ctx, workspace } = await makeTeam();
    const shared = await makeProject(ctx, "Shared", "SHR");
    await makeProject(ctx, "Private", "PRV");
    const { url } = await createInvite(ctx, { role: "GUEST", projectIds: [shared.project.id] });
    const client = await makeUser("Client");
    await acceptInvite(client, { token: tokenOf(url) });

    const projects = await listProjects(userCtx(client.id, workspace.id, "GUEST"));
    expect(projects.map((p) => p.key)).toEqual(["SHR"]);
  });
});

describe("renewing invites", () => {
  it("replaces the link and resets the expiry", async () => {
    const { ctx } = await makeTeam();
    const first = await createInvite(ctx, { role: "MEMBER" });
    await db.invite.update({
      where: { id: first.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const renewed = await renewInvite(ctx, first.invite.id);
    expect(renewed.url).not.toBe(first.url);
    expect(renewed.invite.expired).toBe(false);
    expect(await getInvitePreview(tokenOf(first.url))).toBeNull();
    expect((await getInvitePreview(tokenOf(renewed.url)))?.status).toBe("valid");
  });
});
