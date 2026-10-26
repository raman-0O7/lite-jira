import { describe, expect, it } from "vitest";

import { listIssueActivity } from "@/lib/services/activity";
import { addComment } from "@/lib/services/comments";
import { createIssue, moveIssue, updateIssue } from "@/lib/services/issues";
import { createLabel, deleteLabel } from "@/lib/services/labels";
import { addMember, makeOwner, makeTeam, makeUser, shareProject } from "@/tests/factories";
import { expectStatus, makeIssue, makeProject } from "@/tests/helpers";

describe("issue activity", () => {
  it("lists the issue's history oldest first, without comment rows", async () => {
    const { ctx, workspace, user } = await makeOwner("Owner");
    const { project, todo, doing } = await makeProject(ctx);
    const member = await makeUser("Member");
    await addMember(workspace.id, member, "MEMBER");
    const epic = await makeIssue(ctx, todo.id, "Launch", "EPIC");
    const label = await createLabel(ctx, project.id, { name: "frontend", color: "#3b82f6" });

    const issue = await createIssue(ctx, todo.id, { title: "Login page", assigneeUserId: member.id });
    await updateIssue(ctx, issue.id, { priority: "HIGH", labelIds: [label.id], epicId: epic.id });
    await addComment(ctx, issue.id, { body: "On it" });
    await moveIssue(ctx, { issueId: issue.id, toColumnId: doing.id, toPosition: 0 });

    const { entries, refs } = await listIssueActivity(ctx, issue.id);
    expect(entries.map((e) => e.action)).toEqual(["issue.created", "issue.updated", "issue.moved"]);
    expect(entries.every((e) => e.actor?.id === user.id)).toBe(true);
    expect(entries[1]!.data.changes).toMatchObject({
      priority: { from: "MEDIUM", to: "HIGH" },
      labels: { added: [label.id], removed: [] },
      epicId: { from: null, to: epic.id },
    });

    // Every id the rows mention comes back with a name.
    expect(refs.people[member.id]).toMatchObject({ name: "Member" });
    expect(refs.people[user.id]).toMatchObject({ name: "Owner" });
    expect(refs.columns[todo.id]).toMatchObject({ name: todo.name, category: "TODO" });
    expect(refs.columns[doing.id]).toMatchObject({ name: doing.name, category: "IN_PROGRESS" });
    expect(refs.labels[label.id]).toMatchObject({ name: "frontend" });
    expect(refs.issues[epic.id]).toMatchObject({ key: epic.key, title: "Launch" });
  });

  it("leaves out names that no longer exist", async () => {
    const { ctx } = await makeOwner();
    const { project, todo } = await makeProject(ctx);
    const label = await createLabel(ctx, project.id, { name: "temp", color: "#000000" });
    const issue = await makeIssue(ctx, todo.id);
    await updateIssue(ctx, issue.id, { labelIds: [label.id] });
    await deleteLabel(ctx, label.id);

    const { entries, refs } = await listIssueActivity(ctx, issue.id);
    expect(entries).toHaveLength(2);
    expect(refs.labels).toEqual({});
  });

  it("follows the issue's visibility: guests on shared projects only, nobody outside", async () => {
    const team = await makeTeam();
    const shared = await makeProject(team.ctx, "Shared", "SHR");
    const hidden = await makeProject(team.ctx, "Hidden", "HID");
    const sharedIssue = await makeIssue(team.ctx, shared.todo.id);
    const hiddenIssue = await makeIssue(team.ctx, hidden.todo.id);

    const guestUser = await makeUser("Guest");
    const guest = await addMember(team.workspace.id, guestUser, "GUEST");
    await shareProject(team.workspace.id, guestUser.id, shared.project.id);

    expect((await listIssueActivity(guest, sharedIssue.id)).entries).toHaveLength(1);
    await expectStatus(listIssueActivity(guest, hiddenIssue.id), 404);

    // A member of another workspace can't read it through their own ctx.
    const outsider = await makeOwner("Outsider");
    await expectStatus(listIssueActivity(outsider.ctx, sharedIssue.id), 404);
  });
});
