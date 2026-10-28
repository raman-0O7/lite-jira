import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { db } from "@/lib/db";
import { createAgent } from "@/lib/services/agents";
import { createApiToken, revokeApiToken } from "@/lib/services/api-tokens";
import { createInvite } from "@/lib/services/invites";
import { getSetupStatus } from "@/lib/services/setup";

import { addMember, makeTeam, makeUser, shareProject } from "../factories";
import { makeProject } from "../helpers";

const FIRE_URL = "https://api.anthropic.com/v1/claude_code/routines/trig_01abcDEF/fire";

/** An OAuth client the user has allowed, as Better Auth stores it. */
async function consent(userId: string, client: { clientId?: string; redirectUris: string[] }) {
  const clientId = client.clientId ?? randomUUID();
  const now = new Date();
  await db.oauthClient.create({ data: { id: randomUUID(), clientId, redirectUris: client.redirectUris, name: "Client" } });
  await db.oauthConsent.create({
    data: { id: randomUUID(), clientId, userId, scopes: ["kanso:read"], createdAt: now, updatedAt: now },
  });
}

describe("setup status", () => {
  it("starts with nothing done", async () => {
    const { ctx } = await makeTeam();
    expect(await getSetupStatus(ctx)).toEqual({
      projects: false,
      teammates: false,
      github: false,
      agents: false,
      assistant: false,
      claudeConnected: false,
    });
  });

  it("ticks projects, teammates and agents as they happen", async () => {
    const { ctx } = await makeTeam();
    await makeProject(ctx);
    await createInvite(ctx, { email: "new@example.test", role: "MEMBER" });
    await createAgent(ctx, { kind: "CLAUDE_CODE", name: "Claude", fireUrl: FIRE_URL, token: "sk-ant-routine-token-0123456789" });
    const status = await getSetupStatus(ctx);
    expect(status).toMatchObject({ projects: true, teammates: true, agents: true });
  });

  it("counts a teammate who joined, not only a pending invite", async () => {
    const { ctx, workspace } = await makeTeam();
    await addMember(workspace.id, await makeUser("Grace"), "MEMBER");
    expect((await getSetupStatus(ctx)).teammates).toBe(true);
  });

  it("counts only the projects a guest can see", async () => {
    const { ctx, workspace } = await makeTeam();
    const { project } = await makeProject(ctx);
    const guestUser = await makeUser("Guest");
    const guest = await addMember(workspace.id, guestUser, "GUEST");
    expect((await getSetupStatus(guest)).projects).toBe(false);
    await shareProject(workspace.id, guestUser.id, project.id);
    expect((await getSetupStatus(guest)).projects).toBe(true);
  });

  it("sees a personal token as a connected assistant, until it's revoked", async () => {
    const { ctx } = await makeTeam();
    const { token } = await createApiToken(ctx, { name: "Laptop" });
    expect(await getSetupStatus(ctx)).toMatchObject({ assistant: true, claudeConnected: false });
    await revokeApiToken(ctx, token.id);
    expect((await getSetupStatus(ctx)).assistant).toBe(false);
  });

  it("tells a Claude connector apart from other apps", async () => {
    const { ctx, user } = await makeTeam();
    await consent(user.id, { redirectUris: ["http://localhost:4567/callback"] });
    expect(await getSetupStatus(ctx)).toMatchObject({ assistant: true, claudeConnected: false });
    await consent(user.id, { redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect((await getSetupStatus(ctx)).claudeConnected).toBe(true);
  });

  it("recognises a Claude client by its metadata URL and ignores look-alike hosts", async () => {
    const { ctx, user } = await makeTeam();
    await consent(user.id, { redirectUris: ["https://claude.ai.evil.example/cb"] });
    expect((await getSetupStatus(ctx)).claudeConnected).toBe(false);
    await consent(user.id, { clientId: `https://claude.com/oauth/${randomUUID()}.json`, redirectUris: [] });
    expect((await getSetupStatus(ctx)).claudeConnected).toBe(true);
  });

  it("is per user: a teammate's connector doesn't count for me", async () => {
    const { ctx, workspace } = await makeTeam();
    const other = await makeUser("Grace");
    await addMember(workspace.id, other, "MEMBER");
    await consent(other.id, { redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(await getSetupStatus(ctx)).toMatchObject({ assistant: false, claudeConnected: false });
  });
});
