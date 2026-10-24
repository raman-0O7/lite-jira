import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { db } from "@/lib/db";
import type { Ctx } from "@/lib/services/context";
import {
  createProject,
  deleteProject,
  getProjectByKey,
  getProjectDetail,
  listProjects,
  suggestKey,
  updateProject,
} from "@/lib/services/projects";
import { addMember, makeOwner, makeUser } from "@/tests/factories";
import { expectStatus } from "@/tests/helpers";

describe("suggestKey", () => {
  it.each([
    ["Web app", "WEB"],
    ["iOS", "IOS"],
    ["X", "XP"],
    ["42!", "PRJ"],
  ])("%s → %s", (name, key) => expect(suggestKey(name)).toBe(key));
});

describe("createProject", () => {
  it("seeds categorized columns, suggests a key, and records who created it", async () => {
    const { ctx, user } = await makeOwner();
    const project = await createProject(ctx, { name: "Web app" });

    expect(project).toMatchObject({ name: "Web app", key: "WEB", columnCount: 3, issueCount: 0 });
    const detail = await getProjectDetail(ctx, project.id);
    expect(detail.columns.map((c) => [c.name, c.category])).toEqual([
      ["To Do", "TODO"],
      ["In Progress", "IN_PROGRESS"],
      ["Done", "DONE"],
    ]);
    const activity = await db.activity.findFirstOrThrow();
    expect(activity).toMatchObject({
      action: "project.created",
      projectId: project.id,
      actorType: "USER",
      actorUserId: user.id,
      data: { name: "Web app", key: "WEB", via: "web" },
    });
  });

  it("normalizes and validates explicit keys", async () => {
    const { ctx } = await makeOwner();
    expect((await createProject(ctx, { name: "Mobile", key: " mob2 " })).key).toBe("MOB2");
    for (const key of ["M", "2FA", "TOO-LONG-KEY", "WEB APP"]) {
      await expect(createProject(ctx, { name: "Bad", key })).rejects.toBeInstanceOf(ZodError);
    }
  });

  it("rejects a key already used in the workspace, but allows it in another", async () => {
    const alice = await makeOwner("Alice");
    const bob = await makeOwner("Bob");
    await createProject(alice.ctx, { name: "Web" });
    await expectStatus(createProject(alice.ctx, { name: "Webhooks" }), 409);
    await expect(createProject(bob.ctx, { name: "Web" })).resolves.toMatchObject({ key: "WEB" });
  });

  it("is not allowed for guests", async () => {
    const { workspace } = await makeOwner();
    const guest = await addMember(workspace.id, await makeUser("Guest"), "GUEST");
    await expectStatus(createProject(guest, { name: "Nope" }), 403);
  });
});

describe("workspace isolation", () => {
  it("treats another workspace's project as not found", async () => {
    const alice = await makeOwner("Alice");
    const bob = await makeOwner("Bob");
    const project = await createProject(alice.ctx, { name: "Secret" });

    expect(await listProjects(bob.ctx)).toEqual([]);
    await expectStatus(getProjectDetail(bob.ctx, project.id), 404);
    await expectStatus(getProjectByKey(bob.ctx, "SEC"), 404);
    await expectStatus(updateProject(bob.ctx, project.id, { name: "Mine" }), 404);
    await expectStatus(deleteProject(bob.ctx, project.id), 404);
  });
});

describe("updateProject / deleteProject", () => {
  it("renames and switches mode, but never changes the key", async () => {
    const { ctx } = await makeOwner();
    const project = await createProject(ctx, { name: "Old" });
    const updated = await updateProject(ctx, project.id, { name: "New", mode: "SCRUM" });
    expect(updated).toMatchObject({ name: "New", mode: "SCRUM", key: "OLD" });
    await expectStatus(updateProject(ctx, project.id, { key: "NEW" }), 400);

    const activity = await db.activity.findFirstOrThrow({ where: { action: "project.updated" } });
    expect(activity.data).toMatchObject({
      name: { from: "Old", to: "New" },
      mode: { from: "KANBAN", to: "SCRUM" },
    });
  });

  it("lets admins delete but not members or agents", async () => {
    const { ctx, workspace, user } = await makeOwner();
    const project = await createProject(ctx, { name: "Doomed" });
    const member = await addMember(workspace.id, await makeUser("M"), "MEMBER");
    const agent: Ctx = {
      ...ctx,
      actor: { type: "agent", agentId: "agent_1", onBehalfOf: user.id },
      via: "mcp",
    };
    await expectStatus(deleteProject(member, project.id), 403);
    await expectStatus(deleteProject(agent, project.id), 403);

    const admin = await addMember(workspace.id, await makeUser("A"), "ADMIN");
    await deleteProject(admin, project.id);
    expect(await db.project.count()).toBe(0);
    // History outlives the project.
    expect(await db.activity.count({ where: { projectId: project.id } })).toBe(2);
  });
});
