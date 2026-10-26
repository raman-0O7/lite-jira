import { describe, expect, it } from "vitest";

import { addComment, listComments } from "@/lib/services/comments";
import { getIssue, getIssueByKey, updateIssue } from "@/lib/services/issues";
import { createLabel, listLabels } from "@/lib/services/labels";
import {
  getProject,
  getProjectByKey,
  getProjectDetail,
  listProjects,
} from "@/lib/services/projects";
import { searchIssues } from "@/lib/services/search";
import { addMember, makeTeam, makeUser, shareProject } from "@/tests/factories";
import { expectStatus, makeIssue, makeProject } from "@/tests/helpers";

async function setup() {
  const owner = await makeTeam();
  const shared = await makeProject(owner.ctx, "Shared", "SHR");
  const hidden = await makeProject(owner.ctx, "Hidden", "HID");
  const sharedIssue = await makeIssue(owner.ctx, shared.todo.id, "Visible work");
  const hiddenIssue = await makeIssue(owner.ctx, hidden.todo.id, "Secret work");
  const label = await createLabel(owner.ctx, hidden.project.id, { name: "secret", color: "#ff0000" });
  const guestUser = await makeUser("Client");
  const guest = await addMember(owner.workspace.id, guestUser, "GUEST");
  await shareProject(owner.workspace.id, guestUser.id, shared.project.id);
  return { owner, shared, hidden, sharedIssue, hiddenIssue, label, guest };
}

describe("guest visibility", () => {
  it("lists and opens only shared projects", async () => {
    const { guest, shared, hidden } = await setup();
    expect((await listProjects(guest)).map((p) => p.key)).toEqual(["SHR"]);
    expect((await getProjectDetail(guest, shared.project.id)).key).toBe("SHR");
    await expectStatus(getProjectDetail(guest, hidden.project.id), 404);
    await expectStatus(getProject(guest, hidden.project.id), 404);
    await expectStatus(getProjectByKey(guest, "HID"), 404);
  });

  it("can't reach issues, comments, or labels of unshared projects", async () => {
    const { guest, owner, sharedIssue, hiddenIssue, hidden } = await setup();
    expect((await getIssue(guest, sharedIssue.id)).title).toBe("Visible work");
    await expectStatus(getIssue(guest, hiddenIssue.id), 404);
    await expectStatus(getIssueByKey(guest, "HID-1"), 404);
    await expectStatus(listComments(guest, hiddenIssue.id), 404);
    await expectStatus(addComment(guest, hiddenIssue.id, { body: "hi" }), 404);
    await expectStatus(listLabels(guest, hidden.project.id), 404);

    await addComment(guest, sharedIssue.id, { body: "Looks good" });
    expect(await listComments(owner.ctx, sharedIssue.id)).toHaveLength(1);
  });

  it("only finds shared issues in search", async () => {
    const { guest, owner } = await setup();
    expect((await searchIssues(guest, "work")).map((i) => i.key)).toEqual(["SHR-1"]);
    expect((await searchIssues(guest, "project:HID")).length).toBe(0);
    expect((await searchIssues(owner.ctx, "work")).length).toBe(2);
  });

  it("still can't edit shared issues", async () => {
    const { guest, sharedIssue } = await setup();
    await expectStatus(updateIssue(guest, sharedIssue.id, { title: "Changed" }), 403);
  });
});
