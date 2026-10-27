import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { updateIssue } from "@/lib/services/issues";
import {
  leaveWorkspace,
  listMembers,
  removeMember,
  setMemberProjects,
  updateMemberRole,
} from "@/lib/services/members";
import { addMember, makeOwner, makeTeam, makeUser } from "@/tests/factories";
import { expectStatus, makeIssue, makeProject } from "@/tests/helpers";

async function team() {
  const owner = await makeTeam();
  const adminUser = await makeUser("Admin");
  const admin = await addMember(owner.workspace.id, adminUser, "ADMIN");
  const memberUser = await makeUser("Member");
  const member = await addMember(owner.workspace.id, memberUser, "MEMBER");
  const guestUser = await makeUser("Guest");
  const guest = await addMember(owner.workspace.id, guestUser, "GUEST");
  return { owner, admin, adminUser, member, memberUser, guest, guestUser };
}

const roleOf = async (workspaceId: string, userId: string) =>
  (
    await db.membership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true },
    })
  )?.role;

describe("member roles", () => {
  it("admins manage members and guests; only owners touch admin and owner roles", async () => {
    const { owner, admin, adminUser, memberUser, guestUser } = await team();
    await updateMemberRole(admin, guestUser.id, { role: "MEMBER" });
    expect(await roleOf(owner.workspace.id, guestUser.id)).toBe("MEMBER");

    await expectStatus(updateMemberRole(admin, memberUser.id, { role: "ADMIN" }), 403);
    await expectStatus(updateMemberRole(admin, owner.user.id, { role: "MEMBER" }), 403);
    await expectStatus(updateMemberRole(admin, adminUser.id, { role: "MEMBER" }), 403);

    await updateMemberRole(owner.ctx, memberUser.id, { role: "OWNER" });
    expect(await roleOf(owner.workspace.id, memberUser.id)).toBe("OWNER");
    expect(
      await db.activity.count({
        where: { workspaceId: owner.workspace.id, action: "member.role_changed" },
      }),
    ).toBe(2);
  });

  it("members and guests can't manage anyone", async () => {
    const { member, guest, guestUser, memberUser } = await team();
    await expectStatus(updateMemberRole(member, guestUser.id, { role: "MEMBER" }), 403);
    await expectStatus(removeMember(guest, memberUser.id), 403);
  });

  it("keeps at least one owner", async () => {
    const { owner, memberUser } = await team();
    await expectStatus(updateMemberRole(owner.ctx, owner.user.id, { role: "ADMIN" }), 400);
    await expectStatus(leaveWorkspace(owner.ctx), 400);

    await updateMemberRole(owner.ctx, memberUser.id, { role: "OWNER" });
    await updateMemberRole(owner.ctx, owner.user.id, { role: "ADMIN" });
    expect(await roleOf(owner.workspace.id, owner.user.id)).toBe("ADMIN");
  });

  it("refuses role changes in a personal workspace", async () => {
    const solo = await makeOwner();
    await expectStatus(updateMemberRole(solo.ctx, solo.user.id, { role: "ADMIN" }), 400);
  });

  it("unassigns someone who becomes a guest; drops access rows when a guest is promoted", async () => {
    const { owner, memberUser, guestUser } = await team();
    const { project, todo } = await makeProject(owner.ctx);
    const issue = await makeIssue(owner.ctx, todo.id);
    await updateIssue(owner.ctx, issue.id, { assigneeUserId: memberUser.id });

    await updateMemberRole(owner.ctx, memberUser.id, { role: "GUEST" });
    expect((await db.issue.findUniqueOrThrow({ where: { id: issue.id } })).assigneeUserId).toBeNull();

    await setMemberProjects(owner.ctx, guestUser.id, { projectIds: [project.id] });
    await updateMemberRole(owner.ctx, guestUser.id, { role: "MEMBER" });
    expect(await db.projectAccess.count()).toBe(0);
  });

  it("404s for someone outside the workspace", async () => {
    const { owner } = await team();
    const stranger = await makeUser("Stranger");
    await expectStatus(updateMemberRole(owner.ctx, stranger.id, { role: "MEMBER" }), 404);
  });
});

describe("removing and leaving", () => {
  it("admins remove members but not admins or owners; nobody removes themselves", async () => {
    const { owner, admin, adminUser, memberUser } = await team();
    await expectStatus(removeMember(admin, adminUser.id), 400);
    await expectStatus(removeMember(admin, owner.user.id), 403);
    await removeMember(admin, memberUser.id);
    expect(await roleOf(owner.workspace.id, memberUser.id)).toBeUndefined();

    await removeMember(owner.ctx, adminUser.id);
    expect(await roleOf(owner.workspace.id, adminUser.id)).toBeUndefined();
    expect(await db.activity.count({ where: { action: "member.removed" } })).toBe(2);
  });

  it("leaving unassigns your issues and logs it", async () => {
    const { owner, member, memberUser } = await team();
    const { todo } = await makeProject(owner.ctx);
    const issue = await makeIssue(owner.ctx, todo.id);
    await updateIssue(owner.ctx, issue.id, { assigneeUserId: memberUser.id });

    await leaveWorkspace(member);
    expect(await roleOf(owner.workspace.id, memberUser.id)).toBeUndefined();
    expect((await db.issue.findUniqueOrThrow({ where: { id: issue.id } })).assigneeUserId).toBeNull();
    expect(await db.activity.count({ where: { action: "member.left" } })).toBe(1);
  });

  it("can't leave a personal workspace", async () => {
    const solo = await makeOwner();
    await expectStatus(leaveWorkspace(solo.ctx), 400);
  });
});

describe("guest projects", () => {
  it("sets a guest's projects and shows them only to managers", async () => {
    const { owner, member, guestUser } = await team();
    const web = await makeProject(owner.ctx, "Web", "WEB");
    const api = await makeProject(owner.ctx, "Api", "API");

    await setMemberProjects(owner.ctx, guestUser.id, { projectIds: [web.project.id, api.project.id] });
    await setMemberProjects(owner.ctx, guestUser.id, { projectIds: [api.project.id] });

    const asOwner = (await listMembers(owner.ctx)).find((m) => m.id === guestUser.id);
    expect(asOwner?.projectIds).toEqual([api.project.id]);
    const asMember = (await listMembers(member)).find((m) => m.id === guestUser.id);
    expect(asMember?.projectIds).toEqual([]);
    expect(await db.activity.count({ where: { action: "member.projects_changed" } })).toBe(2);
  });

  it("rejects non-guests and projects from other workspaces", async () => {
    const { owner, memberUser, guestUser } = await team();
    const other = await makeOwner("Other");
    const foreign = await makeProject(other.ctx);
    await expectStatus(setMemberProjects(owner.ctx, memberUser.id, { projectIds: [] }), 400);
    await expectStatus(
      setMemberProjects(owner.ctx, guestUser.id, { projectIds: [foreign.project.id] }),
      400,
    );
  });
});
