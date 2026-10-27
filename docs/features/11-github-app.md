# Feature 11 — GitHub App

**Wave 8 · depends on 07.** See [`PLAN-v2.md`](../PLAN-v2.md) §1, §3, §6 "11 — GitHub App".

## Goal
Connect a workspace to GitHub through a **GitHub App**. Issues assigned to
linked people come in automatically. Status stays in step both ways. Pull
requests that mention an issue key show up on the issue with their checks.
Merging moves the issue to Done.

## Setup (self-hosted)
The operator creates a GitHub App: one for production, and a separate dev app
whose webhook URL points at a tunnel such as smee.io. `docs/github-app.md` has
the manifest and the steps. Configuration comes from environment variables:

| Variable | What |
|---|---|
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG` | The app's id and URL slug |
| `GITHUB_APP_PRIVATE_KEY` | The app's PEM private key (`\n` escapes allowed) |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | The app's OAuth credentials, used to link user accounts |
| `GITHUB_WEBHOOK_SECRET` | Used to verify webhook signatures |
| `ENCRYPTION_KEY` | 32+ random characters; encrypts stored tokens (required in production) |

These are separate from `GITHUB_CLIENT_ID`/`SECRET`, which are only for
"Sign in with GitHub". When the app isn't configured, Settings → Integrations
says so and nothing else changes.

**App permissions:** Issues read & write; Pull requests read; Checks read;
Metadata read.

**App events:** Installation, Installation repositories, Issues, Pull request,
Check suite.

## Model
```
GitHubInstallation  workspaceId, installationId (unique), accountLogin, accountType,
                    createdById, suspendedAt?
GitHubUserLink      userId (unique), githubUserId (unique), login
ProjectRepo         projectId, installationId → GitHubInstallation, repoFullName,
                    importAssigned, statusSync, moveOnMerge; unique(installation, repo)
GitHubIssueLink     issueId (unique), projectRepoId, repoFullName, number, url,
                    state OPEN|CLOSED, lastSyncedAt; unique(repoFullName, number)
PullRequestLink     issueId, repoFullName, number, url, title, branch, headSha,
                    state OPEN|MERGED|CLOSED, checks NONE|PENDING|PASS|FAIL, mergedAt?;
                    unique(issueId, repoFullName, number)
GitHubDelivery      id (= X-GitHub-Delivery), event, receivedAt   # webhook dedupe
```
A repository can be connected to only one project in Kanso.

User tokens are never stored. Linking only records who the person is on
GitHub. Kanso calls GitHub with short-lived installation tokens, minted from
the app key and cached in memory until shortly before they expire.

## Flows

**Install (admins, `integrations.manage`).** Settings → Integrations →
"Install GitHub App" leads to `github.com/apps/<slug>/installations/new` with
a signed, expiring `state` that holds the workspace and user. GitHub returns
to `/api/github/callback` with `installation_id` and an OAuth `code` (the app
has "Request user authorization during installation" turned on). The callback:
1. verifies the state;
2. exchanges the code for a user token;
3. confirms the user can see that installation (`GET /user/installations`);
4. stores the installation and links the user's account.

An installation already attached to another workspace is refused.

**Link account (any member, guests included).** "Link GitHub account" runs the
app's user OAuth flow back to the same callback. It records `githubUserId` and
`login`. One GitHub account maps to one Kanso user. Members can unlink.

**Connect a repository (admins).** Pick an installation repository and a
project. There are three toggles: import assigned issues, status sync, and
move on merge, all on by default. Admins can change the toggles, disconnect a
repository, or remove an installation from Kanso.

**Import.** These issues come in:
- in a connected repository with *import* on;
- open, and not pull requests;
- assigned to a GitHub user linked to a non-guest member of the workspace.

Each becomes a Kanso issue:
- `source = GITHUB`, in the project's first `TODO` column;
- assigned to that member;
- title and body are copied, with the body as the description;
- labels are matched by name, and missing ones are created with GitHub's colour (at most 10 per issue);
- a `GitHubIssueLink` is stored, so it's never imported twice.

Import runs on `issues.opened` and `issues.assigned` webhooks, and on demand
from "Sync now" (members).

**Status sync** (when *status sync* is on):
- **Kanso → GitHub.** When an issue moves into a `DONE` column, the linked
  GitHub issue is closed (`state_reason: completed`). When it moves out, the
  GitHub issue is reopened. The call runs after the response (`after()`), so
  a GitHub outage never blocks a move. Failures are logged, not retried.
  Moves made by the sync itself (`via: "github"`) are not echoed back.
- **GitHub → Kanso.** `issues.closed` moves the issue to the first `DONE`
  column. `issues.reopened` moves it to the first `TODO` column. Edits to the
  title and body on GitHub update the Kanso issue.

**Pull requests.** On `pull_request` opened, edited, reopened,
synchronize and closed events, Kanso searches the branch name, title and body
for issue keys (`WEB-42`, case-insensitive). It only matches projects in the
installation's workspace. Each match upserts a `PullRequestLink`. When a PR
is merged and the repository has *move on merge* on, the issue moves to the
project's first `DONE` column. `check_suite.completed` refreshes the checks of
PRs whose head commit matches; the PR's suites are fetched and combined:
- any failure → FAIL;
- any still running → PENDING;
- otherwise PASS.

**Installation events.** When an installation is deleted, it's removed along
with its repo connections; issue links stay so history survives. A suspended
installation is marked and syncing pauses. `installation_repositories.removed`
disconnects those repositories.

**Copy branch name.** On an issue: `web-42-fix-login-redirect` (key plus
slugified title, at most 60 characters). PRs from that branch link
automatically.

## Webhooks
`POST /api/github/webhooks`:
- verifies `X-Hub-Signature-256` (HMAC-SHA256, constant-time) against the raw body;
- ignores unknown events with 202;
- dedupes on `X-GitHub-Delivery`.

Webhook writes run as `actor: {type: "github", installationId}` with
`via: "github"`, so activity shows "via GitHub". Payload text from GitHub is
untrusted: it's stored as plain data, rendered as Markdown like any
description, and never interpreted.

## UI
- **Settings → Integrations**:
  - shows "Not configured" when the app isn't set up;
  - lists installations, with Install / Remove;
  - shows your GitHub link, with Link / Unlink;
  - lists connected repositories with their project and toggles, and a Sync now button;
  - has a "Connect repository" form.
- **Issue detail, GitHub section**:
  - the linked GitHub issue (repo#number, state, link);
  - linked PRs with state and checks;
  - "Copy branch name".
- **Cards**: a GitHub mark for imported issues. A PR badge shows checks
  status, or a merged state.

## Acceptance criteria
- [x] An admin can install the app; members can't. A forged or expired `state` is rejected.
- [x] Any member can link and unlink their own GitHub account; one GitHub account maps to one user.
- [x] Connecting a repository requires admin; a repository maps to one project.
- [x] Assigned open GitHub issues for linked members import once, into TODO, assigned, with labels.
- [x] Moving into/out of DONE closes/reopens the GitHub issue; the sync's own moves aren't echoed.
- [x] GitHub close/reopen moves the Kanso issue; activity says "via GitHub".
- [x] PRs mentioning a key link to the issue with checks; merge moves it to DONE when enabled.
- [x] Webhooks with a bad signature get 401; a repeated delivery is a no-op.
- [x] No user GitHub token is stored; installation tokens stay in memory only.
- [x] Vitest covers permissions, import, sync both ways, PR linking, and webhook verification against a fake GitHub.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
