import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { db } from "@/lib/db";
import {
  createBoard,
  deleteBoard,
  getBoardDetail,
  listBoards,
  renameBoard,
} from "@/lib/services/boards";
import type { Ctx } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { addMember, makeOwner, makeUser } from "@/tests/factories";

async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).rejects.toBeInstanceOf(ServiceError);
  await promise.catch((error: ServiceError) => expect(error.status).toBe(status));
}

describe("createBoard", () => {
  it("seeds default columns and records who created it", async () => {
    const { ctx, user } = await makeOwner();
    const board = await createBoard(ctx, { name: "Roadmap" });

    expect(board).toMatchObject({ name: "Roadmap", columnCount: 3 });
    const detail = await getBoardDetail(ctx, board.id);
    expect(detail.columns.map((c) => c.name)).toEqual(["To Do", "In Progress", "Done"]);

    const activity = await db.activity.findMany();
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      action: "board.created",
      boardId: board.id,
      workspaceId: ctx.workspaceId,
      actorType: "USER",
      actorUserId: user.id,
      data: { name: "Roadmap", via: "web" },
    });
  });

  it("validates input", async () => {
    const { ctx } = await makeOwner();
    await expect(createBoard(ctx, { name: "  " })).rejects.toBeInstanceOf(ZodError);
    await expect(createBoard(ctx, {})).rejects.toBeInstanceOf(ZodError);
  });

  it("is not allowed for guests", async () => {
    const { workspace } = await makeOwner();
    const guest = await addMember(workspace.id, await makeUser("Guest"), "GUEST");
    await expectStatus(createBoard(guest, { name: "Nope" }), 403);
    expect(await db.board.count()).toBe(0);
  });
});

describe("workspace isolation", () => {
  async function twoWorkspaces() {
    const alice = await makeOwner("Alice");
    const bob = await makeOwner("Bob");
    const board = await createBoard(alice.ctx, { name: "Alice's board" });
    return { alice, bob, board };
  }

  it("only lists boards from the ctx workspace", async () => {
    const { bob } = await twoWorkspaces();
    expect(await listBoards(bob.ctx)).toEqual([]);
  });

  it("treats another workspace's board as not found", async () => {
    const { bob, board } = await twoWorkspaces();
    await expectStatus(getBoardDetail(bob.ctx, board.id), 404);
    await expectStatus(renameBoard(bob.ctx, board.id, { name: "Mine now" }), 404);
    await expectStatus(deleteBoard(bob.ctx, board.id), 404);
    expect(await db.board.findUnique({ where: { id: board.id } })).toMatchObject({
      name: "Alice's board",
    });
  });

  it("lets members of the same workspace collaborate", async () => {
    const { alice, board } = await twoWorkspaces();
    const member: Ctx = await addMember(alice.workspace.id, await makeUser("Carol"), "MEMBER");
    await renameBoard(member, board.id, { name: "Shared" });
    expect((await listBoards(alice.ctx))[0]?.name).toBe("Shared");
  });
});

describe("renameBoard / deleteBoard", () => {
  it("records the rename with before and after", async () => {
    const { ctx } = await makeOwner();
    const board = await createBoard(ctx, { name: "Old" });
    await renameBoard(ctx, board.id, { name: "New" });
    const rename = await db.activity.findFirst({ where: { action: "board.renamed" } });
    expect(rename?.data).toMatchObject({ from: "Old", to: "New" });
  });

  it("lets admins delete but not members", async () => {
    const { ctx, workspace } = await makeOwner();
    const board = await createBoard(ctx, { name: "Doomed" });
    const member = await addMember(workspace.id, await makeUser("M"), "MEMBER");
    const admin = await addMember(workspace.id, await makeUser("A"), "ADMIN");

    await expectStatus(deleteBoard(member, board.id), 403);
    await deleteBoard(admin, board.id);
    expect(await db.board.count()).toBe(0);
    expect(await db.column.count()).toBe(0);
    // History outlives the board.
    expect(await db.activity.count({ where: { boardId: board.id } })).toBe(2);
  });

  it("never lets an agent delete a board, even for an owner", async () => {
    const { ctx, user } = await makeOwner();
    const board = await createBoard(ctx, { name: "Keep" });
    const agent: Ctx = {
      ...ctx,
      actor: { type: "agent", agentId: "agent_1", onBehalfOf: user.id },
      via: "mcp",
    };
    await expectStatus(deleteBoard(agent, board.id), 403);
  });
});
