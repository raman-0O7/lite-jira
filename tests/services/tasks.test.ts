import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createBoard, getBoardDetail } from "@/lib/services/boards";
import { reorderColumns } from "@/lib/services/columns";
import type { Ctx } from "@/lib/services/context";
import { ServiceError } from "@/lib/services/errors";
import { createLabel } from "@/lib/services/labels";
import { createTask, moveTask, updateTask } from "@/lib/services/tasks";
import { makeOwner } from "@/tests/factories";

async function boardWithColumns(ctx: Ctx, name = "Board") {
  const board = await createBoard(ctx, { name });
  const detail = await getBoardDetail(ctx, board.id);
  const [todo, doing, done] = detail.columns;
  return { board, todo: todo!, doing: doing!, done: done! };
}

async function columnTitles(ctx: Ctx, boardId: string) {
  const detail = await getBoardDetail(ctx, boardId);
  return detail.columns.map((c) => c.tasks.map((t) => `${t.position}:${t.title}`));
}

describe("createTask / updateTask", () => {
  it("records only the fields that actually changed", async () => {
    const { ctx } = await makeOwner();
    const { todo } = await boardWithColumns(ctx);
    const task = await createTask(ctx, todo.id, { title: "Write tests" });

    await updateTask(ctx, task.id, { title: "Write tests", priority: "HIGH", description: "soon" });

    const updates = await db.activity.findMany({ where: { action: "task.updated" } });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.data).toMatchObject({
      changes: { priority: { from: "MEDIUM", to: "HIGH" }, description: true },
    });
    expect((updates[0]?.data as { changes: object }).changes).not.toHaveProperty("title");
  });

  it("writes no activity row when nothing changed", async () => {
    const { ctx } = await makeOwner();
    const { todo } = await boardWithColumns(ctx);
    const task = await createTask(ctx, todo.id, { title: "Same" });
    await updateTask(ctx, task.id, { title: "Same" });
    expect(await db.activity.count({ where: { action: "task.updated" } })).toBe(0);
  });

  it("rejects labels from another board and leaves the task untouched", async () => {
    const { ctx } = await makeOwner();
    const a = await boardWithColumns(ctx, "A");
    const b = await boardWithColumns(ctx, "B");
    const foreign = await createLabel(ctx, b.board.id, { name: "bug", color: "#ff0000" });
    const task = await createTask(ctx, a.todo.id, { title: "Task" });

    await expect(
      updateTask(ctx, task.id, { title: "Renamed", labelIds: [foreign.id] }),
    ).rejects.toMatchObject({ status: 404 });

    const after = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(after.title).toBe("Task");
    expect(await db.activity.count({ where: { action: "task.updated" } })).toBe(0);
  });
});

describe("moveTask", () => {
  it("keeps positions contiguous within a column", async () => {
    const { ctx } = await makeOwner();
    const { board, todo } = await boardWithColumns(ctx);
    const a = await createTask(ctx, todo.id, { title: "a" });
    await createTask(ctx, todo.id, { title: "b" });
    await createTask(ctx, todo.id, { title: "c" });

    await moveTask(ctx, { taskId: a.id, toColumnId: todo.id, toPosition: 2 });
    expect((await columnTitles(ctx, board.id))[0]).toEqual(["0:b", "1:c", "2:a"]);
  });

  it("reindexes both columns on a cross-column move and records it", async () => {
    const { ctx } = await makeOwner();
    const { board, todo, doing } = await boardWithColumns(ctx);
    const a = await createTask(ctx, todo.id, { title: "a" });
    await createTask(ctx, todo.id, { title: "b" });
    await createTask(ctx, doing.id, { title: "x" });

    await moveTask(ctx, { taskId: a.id, toColumnId: doing.id, toPosition: 0 });
    const [todoTasks, doingTasks] = await columnTitles(ctx, board.id);
    expect(todoTasks).toEqual(["0:b"]);
    expect(doingTasks).toEqual(["0:a", "1:x"]);

    const move = await db.activity.findFirst({ where: { action: "task.moved" } });
    expect(move).toMatchObject({ taskId: a.id, boardId: board.id });
    expect(move?.data).toMatchObject({ fromColumnId: todo.id, toColumnId: doing.id, toPosition: 0 });
  });

  it("refuses to move a task to another board", async () => {
    const { ctx } = await makeOwner();
    const a = await boardWithColumns(ctx, "A");
    const b = await boardWithColumns(ctx, "B");
    const task = await createTask(ctx, a.todo.id, { title: "stay" });
    await expect(
      moveTask(ctx, { taskId: task.id, toColumnId: b.todo.id, toPosition: 0 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("treats a task in another workspace as not found", async () => {
    const alice = await makeOwner("Alice");
    const bob = await makeOwner("Bob");
    const { todo } = await boardWithColumns(alice.ctx);
    const bobs = await boardWithColumns(bob.ctx);
    const task = await createTask(alice.ctx, todo.id, { title: "private" });
    await expect(
      moveTask(bob.ctx, { taskId: task.id, toColumnId: bobs.todo.id, toPosition: 0 }),
    ).rejects.toBeInstanceOf(ServiceError);
  });
});

describe("reorderColumns", () => {
  it("rejects duplicated or missing ids", async () => {
    const { ctx } = await makeOwner();
    const { board, todo, doing, done } = await boardWithColumns(ctx);
    for (const orderedIds of [
      [todo.id, doing.id],
      [todo.id, doing.id, done.id, done.id],
      [todo.id, doing.id, "nope"],
    ]) {
      await expect(reorderColumns(ctx, { boardId: board.id, orderedIds })).rejects.toMatchObject({
        status: 400,
      });
    }
  });

  it("rewrites positions in the given order", async () => {
    const { ctx } = await makeOwner();
    const { board, todo, doing, done } = await boardWithColumns(ctx);
    await reorderColumns(ctx, { boardId: board.id, orderedIds: [done.id, todo.id, doing.id] });
    const detail = await getBoardDetail(ctx, board.id);
    expect(detail.columns.map((c) => c.name)).toEqual(["Done", "To Do", "In Progress"]);
  });
});
