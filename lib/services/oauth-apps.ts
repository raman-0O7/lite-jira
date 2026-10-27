import { db } from "@/lib/db";
import { notFound } from "@/lib/services/errors";

/**
 * Apps (OAuth clients, e.g. MCP clients) a user has allowed to act as them.
 * These belong to the user, not a workspace: an OAuth token works in every
 * workspace the user is in, with their role there.
 */

/** Allowed apps, newest first, one row per app. */
export async function listConnectedApps(userId: string) {
  const consents = await db.oauthConsent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      clientId: true,
      scopes: true,
      createdAt: true,
      oauthclient: { select: { name: true, uri: true, icon: true } },
    },
  });
  const seen = new Set<string>();
  return consents
    .filter((c) => !seen.has(c.clientId) && seen.add(c.clientId))
    .map((c) => ({
      id: c.id,
      clientId: c.clientId,
      name: c.oauthclient.name ?? hostOf(c.oauthclient.uri) ?? hostOf(c.clientId) ?? "Unnamed app",
      site: hostOf(c.oauthclient.uri),
      icon: c.oauthclient.icon?.startsWith("https://") ? c.oauthclient.icon : null,
      scopes: c.scopes,
      connectedAt: c.createdAt,
    }));
}

/**
 * Disconnect an app: drop the user's consent and every token it holds, so it
 * can't refresh and must ask again. /api/mcp also checks consent on each
 * request, so access tokens already issued stop working at once.
 */
export async function disconnectApp(userId: string, consentId: string) {
  const consent = await db.oauthConsent.findFirst({
    where: { id: consentId, userId },
    select: { clientId: true },
  });
  if (!consent) throw notFound("App not found");
  const where = { userId, clientId: consent.clientId };
  await db.$transaction([
    db.oauthAccessToken.deleteMany({ where }),
    db.oauthRefreshToken.deleteMany({ where }),
    db.oauthConsent.deleteMany({ where }),
  ]);
}

/** Whether the user still allows this client (checked on each MCP request). */
export async function hasConsent(userId: string, clientId: string) {
  const count = await db.oauthConsent.count({ where: { userId, clientId } });
  return count > 0;
}

function hostOf(url: string | null | undefined) {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
