import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { signState } from "@/lib/crypto";
import { db } from "@/lib/db";
import { githubAppConfig } from "@/lib/github/config";
import { completeGitHubAppSetup, getGitHubSettings, startGitHubAppSetup } from "@/lib/services/github";

import { addMember, makeTeam, makeUser } from "../factories";
import { configureGitHubEnv, fakeGitHub, resetGitHub } from "../fake-github";
import { expectStatus } from "../helpers";

const KEYS = [
  "GITHUB_APP_ID",
  "GITHUB_APP_SLUG",
  "GITHUB_APP_PRIVATE_KEY",
  "GITHUB_APP_CLIENT_ID",
  "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_WEBHOOK_SECRET",
] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const unconfigure = () => KEYS.forEach((key) => delete process.env[key]);

beforeAll(() => unconfigure());
afterAll(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  resetGitHub();
});
let calls: ReturnType<typeof fakeGitHub>["calls"];
beforeEach(() => {
  unconfigure();
  delete process.env.OWNER_EMAILS;
  calls = fakeGitHub().calls;
});

const userId = (ctx: { actor: unknown }) => (ctx.actor as { userId: string }).userId;

describe("guided GitHub App setup", () => {
  it("only the server owner (the first account) sees and starts the setup", async () => {
    const { ctx, workspace } = await makeTeam();
    const member = await addMember(workspace.id, await makeUser("Mo"), "MEMBER");
    const other = await makeTeam("Other", "Olga");
    expect((await getGitHubSettings(ctx)).setup).toEqual({ defaultName: "Kanso localhost:3000", local: true });
    expect((await getGitHubSettings(member)).setup).toBeNull();
    // Admin of their own workspace, but not the server's owner.
    expect((await getGitHubSettings(other.ctx)).setup).toBeNull();
    await expectStatus(startGitHubAppSetup(other.ctx, other.workspace.slug, { name: "Kanso" }), 403);
    await expectStatus(startGitHubAppSetup(member, workspace.slug, { name: "Kanso" }), 403);
  });

  it("OWNER_EMAILS names the owners instead", async () => {
    const first = await makeTeam();
    const other = await makeTeam("Other", "Olga");
    process.env.OWNER_EMAILS = ` someone@example.test, ${other.user.email.toUpperCase()} `;
    expect((await getGitHubSettings(first.ctx)).setup).toBeNull();
    expect((await getGitHubSettings(other.ctx)).setup).not.toBeNull();
    await startGitHubAppSetup(other.ctx, other.workspace.slug, { name: "Kanso" });
    await expectStatus(startGitHubAppSetup(first.ctx, first.workspace.slug, { name: "Kanso" }), 403);
    expect(await db.user.count()).toBe(2);
  });

  it("builds a manifest with Kanso's URLs, permissions and events", async () => {
    const { ctx, workspace } = await makeTeam();
    const { action, manifest } = await startGitHubAppSetup(ctx, workspace.slug, { name: "Kanso Acme", org: "acme", public: true });
    const url = new URL(action);
    expect(url.origin + url.pathname).toBe("https://github.com/organizations/acme/settings/apps/new");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(JSON.parse(manifest)).toEqual({
      name: "Kanso Acme",
      url: "http://localhost:3000",
      redirect_url: `http://localhost:3000/${workspace.slug}/settings/integrations/github-app`,
      callback_urls: ["http://localhost:3000/api/github/callback"],
      request_oauth_on_install: true,
      hook_attributes: { url: "http://localhost:3000/api/github/webhooks", active: true },
      public: true,
      default_permissions: { issues: "write", pull_requests: "read", checks: "read", metadata: "read" },
      default_events: ["issues", "pull_request", "check_suite"],
    });

    const personal = new URL((await startGitHubAppSetup(ctx, workspace.slug, { name: "Kanso", org: "" })).action);
    expect(personal.pathname).toBe("/settings/apps/new");
    await expect(startGitHubAppSetup(ctx, workspace.slug, { name: "x".repeat(35) })).rejects.toThrow(/at most 34/);
    await expect(startGitHubAppSetup(ctx, workspace.slug, { name: "Kanso", org: "../evil" })).rejects.toThrow(/organization/);
  });

  it("refuses once the server has an app", async () => {
    const { ctx, workspace } = await makeTeam();
    configureGitHubEnv();
    await expectStatus(startGitHubAppSetup(ctx, workspace.slug, { name: "Kanso" }), 409);
    expect((await getGitHubSettings(ctx)).setup).toBeNull();
  });

  it("hands the credentials back once as env lines that the config reads", async () => {
    const { ctx, workspace } = await makeTeam();
    const state = new URL((await startGitHubAppSetup(ctx, workspace.slug, { name: "Kanso acme" })).action).searchParams.get("state")!;
    const result = await completeGitHubAppSetup(ctx, { code: "manifest-code", state });
    expect(result.app).toEqual({ name: "Kanso acme", slug: "kanso-acme", url: "https://github.com/apps/kanso-acme" });
    expect(result.webhookSecretMissing).toBe(false);
    const lines = result.env.split("\n");
    expect(lines).toEqual([
      "GITHUB_APP_ID=4242",
      "GITHUB_APP_SLUG=kanso-acme",
      "GITHUB_APP_CLIENT_ID=Iv23.new",
      "GITHUB_APP_CLIENT_SECRET=new-client-secret",
      "GITHUB_WEBHOOK_SECRET=new-webhook-secret",
      "GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\\nAAA\\nBBB\\n-----END RSA PRIVATE KEY-----",
    ]);
    expect(calls.at(-1)).toMatchObject({ method: "POST", path: "/app-manifests/manifest-code/conversions", auth: undefined });

    // Pasted as-is (or quoted), the values configure the app.
    for (const quoted of [false, true]) {
      for (const line of lines) {
        const [key, ...rest] = line.split("=");
        const value = rest.join("=");
        process.env[key!] = quoted && key === "GITHUB_APP_PRIVATE_KEY" ? `"${value}"` : value;
      }
      expect(githubAppConfig()).toMatchObject({
        appId: "4242",
        privateKey: "-----BEGIN RSA PRIVATE KEY-----\nAAA\nBBB\n-----END RSA PRIVATE KEY-----",
      });
    }
  });

  it("only the admin who started it can finish it, and a used code says so", async () => {
    const { ctx, workspace } = await makeTeam();
    const admin = await addMember(workspace.id, await makeUser("Ad"), "ADMIN");
    const state = new URL((await startGitHubAppSetup(ctx, workspace.slug, { name: "Kanso" })).action).searchParams.get("state")!;
    await expectStatus(completeGitHubAppSetup(admin, { code: "manifest-code", state }), 403);
    const install = signState({ kind: "install", workspaceId: ctx.workspaceId, userId: userId(ctx) });
    await expectStatus(completeGitHubAppSetup(ctx, { code: "manifest-code", state: install }), 400);
    const used = await completeGitHubAppSetup(ctx, { code: "used-code", state }).catch((e: unknown) => e);
    expect(used).toMatchObject({ status: 400, message: expect.stringMatching(/shown only once/) });
  });
});
