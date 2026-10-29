import type { GhManifestApp } from "@/lib/github/client";
import { GITHUB_WEB } from "@/lib/github/config";

/**
 * The GitHub App manifest flow (docs/features/15-github-setup.md): GitHub
 * creates an app with every setting filled in, then hands its credentials
 * back once. Kanso shows them as environment variables and keeps nothing.
 */

export const APP_NAME_MAX = 34;

export function appManifest(origin: string, input: { name: string; public: boolean; redirectUrl: string }) {
  return {
    name: input.name,
    url: origin,
    redirect_url: input.redirectUrl,
    callback_urls: [`${origin}/api/github/callback`],
    request_oauth_on_install: true,
    hook_attributes: { url: `${origin}/api/github/webhooks`, active: true },
    public: input.public,
    default_permissions: { issues: "write", pull_requests: "read", checks: "read", metadata: "read" },
    default_events: ["issues", "pull_request", "check_suite"],
  };
}

/** Where the browser posts the manifest: a personal account, or an organization. */
export function manifestFormAction(state: string, org?: string) {
  const path = org ? `/organizations/${encodeURIComponent(org)}/settings/apps/new` : "/settings/apps/new";
  const url = new URL(`${GITHUB_WEB}${path}`);
  url.searchParams.set("state", state);
  return url.toString();
}

/** A default app name: GitHub App names are global and at most 34 characters. */
export function defaultAppName(origin: string) {
  const host = new URL(origin).host;
  return `Kanso ${host}`.slice(0, APP_NAME_MAX).trim();
}

/** The app's credentials as .env lines (the PEM on one line with \n escapes, unquoted). */
export function envLines(app: GhManifestApp) {
  return [
    `GITHUB_APP_ID=${app.id}`,
    `GITHUB_APP_SLUG=${app.slug}`,
    `GITHUB_APP_CLIENT_ID=${app.client_id}`,
    `GITHUB_APP_CLIENT_SECRET=${app.client_secret}`,
    ...(app.webhook_secret ? [`GITHUB_WEBHOOK_SECRET=${app.webhook_secret}`] : []),
    `GITHUB_APP_PRIVATE_KEY=${app.pem.trim().replace(/\r?\n/g, "\\n")}`,
  ];
}

export const isLocalOrigin = (origin: string) => /^https?:\/\/(localhost|127\.|\[::1\])/.test(origin);
