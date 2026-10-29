import { db } from "@/lib/db";
import { authorize } from "@/lib/permissions";
import { actingUserId, type Ctx } from "@/lib/services/context";
import { projectScope } from "@/lib/services/scope";

/** Hosts whose OAuth clients are Claude itself (claude.ai connectors, Claude Code on the web). */
const CLAUDE_HOSTS = ["claude.ai", "claude.com"];

function isClaudeUrl(url: string) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && CLAUDE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

/**
 * Which setup steps are done, for the caller in this workspace
 * (docs/features/13-guided-setup.md "Setup status"). Every field is a fact the
 * app can see, so the checklist and the agent setup dialog tick themselves.
 */
export async function getSetupStatus(ctx: Ctx) {
  authorize(ctx, "workspace.read");
  const userId = actingUserId(ctx) ?? "";
  const now = new Date();
  const [projects, members, invites, github, agents, tokens, consents, repos] = await Promise.all([
    db.project.count({ where: projectScope(ctx) }),
    db.membership.count({ where: { workspaceId: ctx.workspaceId } }),
    db.invite.count({
      where: { workspaceId: ctx.workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    }),
    db.gitHubInstallation.count({ where: { workspaceId: ctx.workspaceId, suspendedAt: null } }),
    db.agent.count({ where: { workspaceId: ctx.workspaceId } }),
    db.apiToken.count({
      where: {
        userId,
        workspaceId: ctx.workspaceId,
        agentId: null,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    db.oauthConsent.findMany({
      where: { userId },
      select: { oauthclient: { select: { clientId: true, redirectUris: true } } },
    }),
    db.projectRepo.findMany({
      where: { project: projectScope(ctx), installation: { suspendedAt: null } },
      orderBy: { repoFullName: "asc" },
      select: { repoFullName: true },
    }),
  ]);

  return {
    projects: projects > 0,
    teammates: members > 1 || invites > 0,
    github: github > 0,
    agents: agents > 0,
    // An AI client acts as the caller here: an app they allowed, or a personal token.
    assistant: consents.length > 0 || tokens > 0,
    // Kanso is a connector on the caller's Claude account, which a routine needs.
    claudeConnected: consents.some(
      ({ oauthclient }) => isClaudeUrl(oauthclient.clientId) || oauthclient.redirectUris.some(isClaudeUrl),
    ),
    // Repos connected to projects the caller sees: what a Claude Code task should clone.
    repositories: repos.map((repo) => repo.repoFullName),
  };
}

export type SetupStatus = Awaited<ReturnType<typeof getSetupStatus>>;
