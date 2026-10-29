# Feature 15 — GitHub setup and agent repositories

**Depends on 11, 12, 13.**

## Goal
A Claude Code agent works in a cloud copy of a GitHub repository. Kanso has to
know which repository an issue belongs to, tell the agent, and make getting
GitHub connected a few clicks rather than a page of manual settings.

Three gaps closed:
1. **No app, no GitHub.** Without the `GITHUB_APP_*` variables, Integrations
   only said "isn't configured". Admins now create the app from that page.
2. **Runs didn't name a repo.** The fire text was just the issue key, so the
   session worked in whatever repo the scheduled task happened to pick.
3. **Nothing stopped a run with no repo.** Claude Code runs now need one.

## Two layers: register once, install per workspace
- **Register** (once per server, by whoever runs it): create the GitHub App,
  which gives Kanso its identity on GitHub: an app ID and keys that sign its
  API calls and webhooks. These are server-wide, so they live in environment
  variables.
- **Install** (per workspace, any admin): Install GitHub App, pick their own
  GitHub account or organization and repositories. Stored in the database
  (`GitHubInstallation`); no environment changes. Each workspace sees only its
  own installations.

## Who is the server owner
`isServerOwner` (`lib/server-owner.ts`): a user whose email is in
`OWNER_EMAILS` (comma-separated, case-insensitive), or, when that's unset, the
first account ever created (whoever deployed the server). Only they see the
registration card and can start or finish it (403 otherwise). Other admins see
"GitHub isn't available on this server yet. Whoever runs this Kanso server
sets it up once; then you can install it here on your own GitHub account."

## Register the app (manifest flow)
Settings → Integrations, while the server has no GitHub App, shows the server
owner (when they admin that workspace) a **Set up GitHub for this server · One
time** card:
- **App name** (default `Kanso <host>`, at most 34 characters; GitHub names are
  global, and GitHub lets you edit it on its form).
- **Organization** (optional): own the app as an organization you administer.
- **Let other GitHub accounts install it** (off by default → `public`).
- A warning when the server's address is local: GitHub can't deliver webhooks.

**Create on GitHub** asks the server for the manifest
(`POST /api/workspaces/[slug]/github/app`), then posts it to
`github.com/settings/apps/new` (or `/organizations/<org>/settings/apps/new`)
with a signed `state` (1 hour, bound to the workspace and admin). The manifest:

| field | value |
|-|-|
| `url` | `BETTER_AUTH_URL` |
| `redirect_url` | `/<slug>/settings/integrations/github-app` |
| `callback_urls` | `/api/github/callback` |
| `request_oauth_on_install` | true |
| `hook_attributes.url` | `/api/github/webhooks` |
| permissions | issues write; pull requests, checks, metadata read |
| events | issues, pull_request, check_suite |

GitHub creates the app and sends the admin to `redirect_url` with a one-time
`code`. That page posts `{code, state}` to
`POST /api/workspaces/[slug]/github/app/complete`, which checks the state (same
workspace, same user, kind `manifest`, still the server owner), trades the code at
`POST /app-manifests/{code}/conversions`, and returns the app's credentials as
`.env` lines: `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, and
`GITHUB_APP_PRIVATE_KEY` on one line with `\n` escapes (the config also accepts
it wrapped in quotes). The page shows them once, secrets masked until
revealed, with **Copy all** and **Download .env**, then: add them to the host
(Vercel: paste the block into the first Key field), redeploy, install the app.

**Nothing is stored.** An app's credentials are server-wide: whoever holds
them receives every installation's webhooks. Storing them from a click would
let anyone who could click take that over, so only the environment, which only
the owner controls, decides which app the server uses. The response is `no-store`; the private key is never logged. A used or
expired code says the credentials are shown only once. Once the server has an
app, starting again is refused (409).

## Which repository
`issueRepository(issueId)` in `lib/agents/repo.ts`:
1. the repo the issue was imported from (`GitHubIssueLink`);
2. else the project's first connected repo (oldest `ProjectRepo` whose
   installation isn't suspended);
3. else none.

Used by:
- **Dispatch.** Claude Code fire text:
  `Kanso issue WEB-42 in workspace "acme". Repository: acme/web`. MCP webhooks
  get `repository: {fullName, url}` (or null).
- **claim_issue** returns `repository` and, as its first rule, "Work only in
  acme/web. If you don't have that repository, call release_issue saying so."
- **The routine prompt** (in the setup dialog): work only in the repository
  claim_issue names; release the issue if the session doesn't have it.

## Guard
Assigning or retrying a Claude Code agent on an issue with no repository fails
with 400: "Connect a GitHub repository to <project> first (Settings →
Integrations), so Claude knows which code to work on." Nothing changes and no
run starts. A repo disconnected between assigning and dispatch fails the
queued run ("The project has no connected GitHub repository"). MCP agents
don't need a repository.

## Setup dialog
- Setup status gains `repositories`: repos connected to projects the caller
  can see.
- The Claude Code task's **Choose your repository** step names the repo when
  there's one, lists them when there are several (one agent per repo), and
  links to Integrations when there's none.
- A note links to the Claude GitHub app for repos Claude can't see yet.

## Acceptance criteria
- [x] Only the server owner (OWNER_EMAILS, else the first account) registers the app; other admins see that it isn't available yet.
- [x] The manifest carries Kanso's URLs, permissions and events; org and public options work.
- [x] Credentials are shown once as env lines the config reads; never stored or logged.
- [x] Only the admin who started it can finish it; a used code says so; a configured server refuses.
- [x] Runs name the repository (fire text, webhook, claim_issue); imported issues use their own repo.
- [x] Claude Code can't be assigned or retried without a repository; a queued run fails if it was removed.
- [x] The setup dialog names the connected repositories.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
