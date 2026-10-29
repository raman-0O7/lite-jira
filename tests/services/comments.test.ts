import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { cleanName, MAX_ATTACHMENT_BYTES, readImages, sniffImage } from "@/lib/attachments";
import { addComment, deleteComment, editComment, getAttachment, listComments } from "@/lib/services/comments";
import type { Ctx } from "@/lib/services/context";
import { addMember, makeOwner, makeUser, shareProject } from "@/tests/factories";
import { expectStatus, makeIssue, makeProject } from "@/tests/helpers";

async function setup() {
  const owner = await makeOwner("Owner");
  const { project, todo } = await makeProject(owner.ctx);
  const issue = await makeIssue(owner.ctx, todo.id);
  const member = await addMember(owner.workspace.id, await makeUser("Member"), "MEMBER");
  const guestUser = await makeUser("Guest");
  const guest = await addMember(owner.workspace.id, guestUser, "GUEST");
  await shareProject(owner.workspace.id, guestUser.id, project.id);
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
    await db.agent.create({
      data: { id: "agent_claude", workspaceId: owner.ctx.workspaceId, name: "Claude", kind: "MCP", ownerUserId: owner.user.id, configEnc: "x" },
    });
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

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
const file = (bytes: Uint8Array | string, name: string, type = "image/png") =>
  new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type });

describe("comment images", () => {
  it("identifies images by their bytes, not their name or claimed type", async () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(Buffer.from("ffd8ffe000", "hex"))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from("GIF89a"))).toBe("image/gif");
    expect(sniffImage(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();

    await expect(readImages([file("<svg/>", "x.png")])).rejects.toThrow(/Only PNG, JPEG, GIF, and WebP/);
    await expect(readImages([file("", "empty.png")])).rejects.toThrow(/empty/);
    await expect(readImages([1, 2, 3, 4].map((n) => file(PNG, `${n}.png`)))).rejects.toThrow(/at most 3/);
    const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
    big.set(PNG);
    await expect(readImages([file(big, "big.png")])).rejects.toThrow(/4 MB/);

    const [image] = await readImages([file(PNG, "../../etc/screen shot.gif", "image/gif")]);
    expect(image).toMatchObject({ name: "screen shot.png", contentType: "image/png" });
    expect(cleanName('a\u0000"b.jpeg', "image/jpeg")).toBe("ab.jpg");
  });

  it("are stored with the comment and readable only where the issue is", async () => {
    const { owner, issue, guest } = await setup();
    const images = await readImages([file(PNG, "shot.png")]);
    await expect(addComment(owner.ctx, issue.id, { body: "" })).rejects.toThrow(/can.t be empty/);
    const comment = await addComment(owner.ctx, issue.id, { body: "" }, images);
    expect(comment.attachments).toEqual([
      expect.objectContaining({ name: "shot.png", contentType: "image/png", size: PNG.length }),
    ]);
    const id = comment.attachments[0]!.id;
    expect(Buffer.from((await getAttachment(guest, id)).data).equals(PNG)).toBe(true);

    const other = await makeOwner("Eve");
    await expectStatus(getAttachment(other.ctx, id), 404);
    await deleteComment(owner.ctx, comment.id);
    expect(await db.attachment.count()).toBe(0);
  });
});
