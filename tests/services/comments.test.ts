import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { addComment, deleteComment, editComment, listComments } from "@/lib/services/comments";
import type { Ctx } from "@/lib/services/context";
import { addMember, makeOwner, makeUser } from "@/tests/factories";
import { expectStatus, makeIssue, makeProject } from "@/tests/helpers";

async function setup() {
  const owner = await makeOwner("Owner");
  const { todo } = await makeProject(owner.ctx);
  const issue = await makeIssue(owner.ctx, todo.id);
  const member = await addMember(owner.workspace.id, await makeUser("Member"), "MEMBER");
  const guest = await addMember(owner.workspace.id, await makeUser("Guest"), "GUEST");
  return { owner, issue, member, guest };
}

describe("comments", () => {
  it("can be added by members and guests, oldest first, with history", async () => {
    const { owner, issue, member, guest } = await setup();
    await addComment(member, issue.id, { body: "first" });
    await addComment(guest, issue.id, { body: "second" });

    const comments = await listComments(owner.ctx, issue.id);
    expect(comments.map((c) => [c.body, c.author?.name])).toEqual([
      ["first", "Member"],
      ["second", "Guest"],
    ]);
    expect(await db.activity.count({ where: { action: "comment.added", issueId: issue.id } })).toBe(2);
  });

  it("rejects empty bodies", async () => {
    const { member, issue } = await setup();
    await expect(addComment(member, issue.id, { body: "   " })).rejects.toThrow();
  });

  it("can only be edited by the author", async () => {
    const { owner, issue, member } = await setup();
    const comment = await addComment(member, issue.id, { body: "typo" });
    await expectStatus(editComment(owner.ctx, comment.id, { body: "not mine" }), 403);
    const edited = await editComment(member, comment.id, { body: "fixed" });
    expect(edited.body).toBe("fixed");
    expect(edited.editedAt).not.toBeNull();
  });

  it("can be deleted by the author or an admin, not other members", async () => {
    const { owner, issue, member, guest } = await setup();
    const mine = await addComment(guest, issue.id, { body: "guest note" });
    await expectStatus(deleteComment(member, mine.id), 403);
    await deleteComment(guest, mine.id);

    const another = await addComment(member, issue.id, { body: "moderate me" });
    await deleteComment(owner.ctx, another.id);
    expect(await db.comment.count()).toBe(0);
  });

  it("from an agent are attributed to the agent and its user", async () => {
    const { owner, issue } = await setup();
    const agent: Ctx = {
      ...owner.ctx,
      actor: { type: "agent", agentId: "agent_claude", onBehalfOf: owner.user.id },
      via: "mcp",
    };
    const comment = await addComment(agent, issue.id, { body: "Plan: …" });
    expect(comment).toMatchObject({ authorAgentId: "agent_claude", author: { id: owner.user.id } });
    // The user can't edit the agent's comment as if it were their own.
    await expectStatus(editComment(owner.ctx, comment.id, { body: "x" }), 403);
  });

  it("on another workspace's issue are not found", async () => {
    const { issue } = await setup();
    const stranger = await makeOwner("Stranger");
    await expectStatus(addComment(stranger.ctx, issue.id, { body: "hi" }), 404);
  });
});
