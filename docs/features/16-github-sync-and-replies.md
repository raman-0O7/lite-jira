# Feature 16 — GitHub sync, comment images, and replies that resume agents

**Depends on 11, 12, 15.**

## Goal
Four gaps closed:
1. **Unassigned GitHub issues never came in.** Import only took issues assigned
   to a linked member, so a fresh issue nobody had picked up couldn't be handed
   to an agent from Kanso.
2. **Missed webhooks stayed missed.** If Kanso was down or a delivery failed,
   new issues and closes on GitHub never arrived.
3. **The repo was a settings detail.** Connecting a repository meant leaving
   the project for Settings → Integrations.
4. **An agent that asked a question had no clear way to get an answer.**
   Claude Code sessions ended after asking, and people could only answer in
   text.

Plus a board filter by assignee.

## Import modes
`ProjectRepo.importIssues` (`ALL` · `ASSIGNED` · `OFF`) replaces the
`importAssigned` toggle. The migration maps on → `ASSIGNED`, off → `OFF`. New
connections default to `ALL`.

| Mode | Open GitHub issue comes in as |
|------|-------------------------------|
| All open issues | assigned to the linked member it's assigned to on GitHub, else unassigned |
| Issues assigned to linked members | as before (F11) |
| Don't import | nothing |

Pull requests and closed issues are never imported; guests are never import
targets. Unassigned imports land in the project's first TODO column, ready to
assign to a person or an agent. Integrations shows a select per repo instead of
the checkbox, and when the repo last synced.

## Sync
Webhooks stay the live path (`issues.opened`, `assigned`, `reopened` import by
the repo's mode; `closed`/`reopened` move linked issues when status sync is on).

`syncRepo` catches a connected repo up:
- **First time** (no `lastSyncedAt`): import the open issues the mode covers
  (`ALL`: `GET /repos/{repo}/issues?state=open`, up to 300; `ASSIGNED`: per
  linked member, as before).
- **After that:** `GET /repos/{repo}/issues?state=all&since=<lastSyncedAt − 1 min>`.
  New open issues import by mode; linked ones get missed closes and reopens.
- `lastSyncedAt` is set to when the sync started. Changing a repo's mode
  clears it, so switching to `ALL` imports what's open now.

It runs:
- after connecting a repo or changing its mode (after the response);
- from **Sync now** (members; the toast says what it imported and updated);
- from the cron: `GET /api/cron/github-sync` with `Authorization: Bearer
  $CRON_SECRET` syncs every repo of every non-suspended installation (one
  failing doesn't stop the rest) and returns `{repos, imported, updated,
  failed}`. `vercel.json` schedules it daily (Vercel Hobby allows daily crons;
  point any scheduler at it for more).

## Repo when creating a project
- **New project** shows an optional **GitHub repository** select to admins
  when the workspace has an installation with unconnected repos. The project
  is created, then the repo is connected; if connecting fails the project still
  exists and a toast says why.
- **Project header** shows the connected repo(s) as chips linking to GitHub.
  With none, admins get **Connect repo**: a popover with the same select, or a
  pointer to Integrations when GitHub isn't set up or installed. Hidden below
  `md`.
- `getProjectDetail` returns `repos: {id, repoFullName}[]` (non-suspended
  installations).

## Images
Comments can carry up to 3 images, 4 MB in total (Vercel caps request bodies at
4.5 MB). Stored in Postgres (`Attachment`: name, contentType, size, bytes,
cascade with the comment), so there's no storage service to run.
- **Upload:** `POST /api/issues/[id]/comments` as `multipart/form-data` with
  `body` and `image` files; JSON still works for text. With images the text
  may be empty.
- **Validation** (`lib/attachments.ts`): PNG, JPEG, GIF and WebP only,
  identified by magic bytes (never the name or claimed type; SVG is refused
  since it can carry script). Names lose any path and control characters and
  get the right extension.
- **Serve:** `GET /api/attachments/[id]`, for anyone who can see the issue
  (404 otherwise), with `nosniff`, `Content-Security-Policy: default-src 'none';
  sandbox`, and a private cache.
- **Composer:** attach button, paste from the clipboard, thumbnails with
  remove; comments show the images, linking to the full size.
- **MCP:** `get_issue` lists each comment's images (`id`, `name`, `type`,
  `bytes`); the new read-only `get_attachment` returns the image as MCP image
  content so the agent can see it.

## Answering an agent
**Claude Code: answer in its session.** The scheduled task API can only start
new sessions, so a reply in Kanso can't reach a running one, and starting a new
session per answer loses the agent's context. Instead the agent asks and waits:
- The routine prompt and `claim_issue`'s rules say: commit and push, call
  `report_progress` with `needs_input` saying exactly what's needed, then stop
  and wait in the session (don't release). When answered, call
  `report_progress` with `working` and carry on.
- A session waiting for its user is idle, so waiting costs nothing, for as long
  as it takes.
- The issue shows "<agent> needs input" with **Open session** (the run's
  `sessionUrl`) to the agent's owner: the session lives in their Claude
  account, so only they can open it. They answer there, images included.
  Everyone else sees that the owner answers in the session and that comments
  here don't reach it. The sidebar link reads "Answer in session".
- `listAgentRuns` returns `agent.owner` so the issue knows who that is.
- Kanso comments never fire the routine.

**MCP agents: answer in a comment.** When a person who can dispatch (members
and up, acting as themselves) comments while an MCP agent's latest run is
`NEEDS_INPUT`, `resumeRun` runs after the response: a signed `issue.comment`
webhook (`issue`, `repository`, `run`, `comment.id`), and the run goes back to
`RUNNING` with "<person> replied, so <agent> picked the issue back up"
(`agent.resumed`). Agents' own comments and guests' comments change nothing.
The issue shows "<agent> needs your input. Reply below (text or images)…"
above the composer.

**Prompts.** Teammates' comments are instructions for the work, and images
are read with `get_attachment`. GitHub-imported text stays untrusted. GitHub
issue comments aren't synced.

The watchdog times `DISPATCHED` runs from `dispatchedAt`.

## Assignee filter
The board and list filter bar gains **Assignee**: Unassigned, then each person
and agent on the board's issues (OR within, AND with the other filters). In the
URL as `assignee=user:<id>,agent:<id>,none`.

## Acceptance criteria
- [x] `ALL` imports every open issue, unassigned unless a linked member has it; `ASSIGNED` and `OFF` behave as named; webhooks follow the mode.
- [x] Later syncs import new issues and apply closes the webhooks missed; changing the mode re-imports.
- [x] The sync cron needs `CRON_SECRET` and syncs every repo; `vercel.json` schedules it daily.
- [x] New project can connect a repo; the project header shows it or offers Connect repo.
- [x] Comment images: type by magic bytes, ≤ 3 and ≤ 4 MB, served only to people who can see the issue; MCP lists and returns them.
- [x] A waiting Claude Code run points its owner to the session (no new session, no cost while waiting); comments don't fire it. MCP agents get `issue.comment`; guests' and agents' comments change nothing.
- [x] Assignee filter, kept in the URL.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
