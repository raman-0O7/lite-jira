# Feature 12 — Agents & dispatcher

**Wave 9 · depends on 10, 11.** See [`PLAN-v2.md`](../PLAN-v2.md) §1, §4, §6 "12 — Agents & dispatcher".

## Goal
AI agents are teammates you can assign issues to. Assigning an issue to an
agent dispatches it to the agent's runtime. The agent claims the issue
through MCP, reports progress, and opens a PR. The GitHub App links the PR
and moves the card to Review. A human merges, and the issue is done. Every
step shows on the card and in the issue's history.

```
Assign WEB-42 to "Claude" ─► AgentRun QUEUED ─► adapter.dispatch()   (after the response)
  Claude Code: POST the routine's /fire URL, text naming WEB-42 and its repo ─► session URL saved, DISPATCHED
  MCP agent:   signed webhook to the agent (optional); it can also poll list_agent_queue ─► DISPATCHED
  agent ─MCP─► claim_issue ─► RUNNING, card "Claude working", moved to In Progress
        ─MCP─► report_progress / add_comment (authored by the agent)
        ─git─► branch web-42-…, PR mentioning WEB-42 ─► PR linked ─► PR_OPEN, card → "Review" column if present
  human merges ─► DONE (the GitHub App's move-on-merge sends the card to Done)
  not claimed within N minutes ─► FAILED (watchdog); Retry starts a new run
```

## Model
```
Agent      workspaceId, name, kind CLAUDE_CODE|MCP, ownerUserId, configEnc, enabled
AgentRun   workspaceId, issueId, agentId, requestedByUserId?, status, externalSessionId?,
           sessionUrl?, prUrl?, error?, dispatchedAt?, claimedAt?, finishedAt?
           status: QUEUED|DISPATCHED|RUNNING|NEEDS_INPUT|PR_OPEN|DONE|FAILED|CANCELLED
ApiToken   + agentId?        # an agent's own MCP token
```
`Issue.assigneeAgentId`, `Issue.claimedByAgentId`, `Comment.authorAgentId` and
`Activity.actorAgentId` get their foreign keys (SET NULL on delete).

`configEnc` is AES-256-GCM JSON (`lib/crypto.ts`):
- **CLAUDE_CODE**: `{fireUrl, token}`.
- **MCP**: `{webhookUrl?, webhookSecret}`.

Secrets are shown once, never returned again, and never logged.

## Who can do what
| Action | Owner/Admin | Member | Guest | Agent / token |
|---|:-:|:-:|:-:|:-:|
| Create, edit, disable, delete agents; mint agent tokens (`agent.manage`) | ✓ | — | — | never |
| Assign an issue to an agent, retry a run (`agent.dispatch`) | ✓ | ✓ | — | never |
| Claim / report / release (as the assigned agent) | — | — | — | ✓ |

An agent acts **on behalf of its owner**: the owner's role in the
workspace, capped by `AGENT_NEVER` (no deletes, members, integrations,
agents or tokens). The owner is the admin who created it; Claude Code
routines run on the owner's claude.ai account.

## Identity over MCP
- **Agent token** (`kanso_…` with `agentId`, minted in Settings → Agents): the
  actor is `{type: "agent", agentId, onBehalfOf: owner}`, with write access.
  Disabling or deleting the agent revokes it at once.
- **OAuth connection** (a Claude Code routine with Kanso as a connector signs
  in as its owner): agent tools resolve the issue's assigned agent. It must be
  owned by the caller, and from then on the agent is the actor. Kanso never
  sees Claude.ai credentials.

## Adapters (`lib/agents/`)
- **Claude Code.** `POST {fireUrl}` sends:
  - headers `Authorization: Bearer <token>`, `anthropic-version: 2023-06-01`,
    `anthropic-beta: experimental-cc-routine-2026-04-01`;
  - body `{text: "Kanso issue WEB-42 in workspace \"acme\". Repository: acme/web"}`
    (the repository: see [15-github-setup.md](15-github-setup.md)).

  The fire URL must be `https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`.
  A 200 response saves `claude_code_session_id` and the session URL. **Fires
  are never auto-retried** (the API isn't idempotent). Any failure marks the
  run FAILED with the API's message, and the user can Retry. The fire payload
  reaches the session as untrusted data, so the routine prompt we provide
  tells the agent to treat it only as an issue key.
- **Generic MCP.** If a webhook URL is set (HTTPS, public host), Kanso POSTs:
  - body `{event: "issue.assigned", workspace, issue: {key, title, url}, run: {id}}`;
  - header `X-Kanso-Signature: sha256=HMAC(secret, body)`.

  The run becomes DISPATCHED either way. Agents without a webhook poll
  `list_agent_queue`. This replaces the plan's "Ready for agent" column with
  the issue's agent assignment, which is the same signal without
  configuring a column.

## MCP tools (agent-facing)
- `list_agent_queue` lists issues assigned to the agent (or to the caller's
  agents) that aren't done.
- `claim_issue {key}` locks the issue to the agent and sets the run to
  RUNNING. It moves the issue to In Progress if it was in a To Do column.
  It returns the issue, a branch name, and the rules. A claim by another
  agent is a 409.
- `report_progress {key, message, status?: "working"|"needs_input"}` adds a
  comment authored by the agent and updates the run. A teammate's reply to a
  `needs_input` run resumes it (Feature 16).
- `release_issue {key, reason?}` clears the claim, marks the run FAILED with
  the reason, and posts an optional comment.

Content imported from GitHub is labeled untrusted in every issue payload
(`untrusted: true` and a notice). Agents push branches and open PRs; merging
is always human (the GitHub App has no merge permission).

## Lifecycle
- **Assign.** Members and above. Clears the user assignee. Any active run
  for the issue becomes CANCELLED. Assigning a user (or nobody) does the
  same to the agent assignment.
- **PR linked** for an issue with an active run → PR_OPEN with `prUrl`. The
  issue moves to the first column named "Review" or "In Review", if there is
  one. **Merged** → DONE and the claim is cleared.
- **Watchdog.** A QUEUED or DISPATCHED run that isn't claimed within
  `AGENT_CLAIM_TIMEOUT_MINUTES` (default 15) becomes FAILED and the issue's
  history notes it. It runs on `GET /api/cron/agent-watchdog` (Bearer
  `CRON_SECRET`; Vercel Cron) and also whenever runs are read.
- **Retry.** Members can retry a FAILED or CANCELLED run when the issue is
  still assigned to the agent; this starts a new run.

Run changes are recorded as issue activity (`agent.assigned`,
`agent.claimed`, `agent.progress`, `agent.pr_opened`, `agent.done`,
`agent.failed`, `agent.released`).

## UI
- **Settings → Agents** (admins manage; others can view):
  - add a Claude Code or MCP agent through the guided setup dialog
    ([13-guided-setup.md](13-guided-setup.md) "Agent setup");
  - enable / disable, delete;
  - mint agent tokens, with webhook secret and token shown once.
- **Assignee picker**: lists agents under members, with an "Add an AI
  agent…" shortcut for admins (feature 13).
- **Cards**: bot avatar and a run badge (Queued, Dispatched, Working, Needs
  input, PR open, Failed).
- **Issue sidebar, Agent block**: status, ▶ Watch session (Claude Code
  session URL), PR link, error, Retry, and the last runs.

## Acceptance criteria
- [x] Only admins manage agents; members can assign issues to agents; guests and tokens can't.
- [x] Secrets are encrypted at rest and never returned after creation.
- [x] Assigning dispatches after the response; Claude Code fire saves the session URL; failures → FAILED, no auto-retry.
- [x] Agent tokens act as the agent on behalf of the owner, capped; disabled agents' tokens are rejected.
- [x] claim / report / release work only for the assigned agent; claims are exclusive.
- [x] PR linked → PR_OPEN (+ Review column); merge → DONE.
- [x] Watchdog fails unclaimed runs; Retry dispatches a new run.
- [x] GitHub-imported content is labeled untrusted in agent payloads.
- [x] Vitest covers permissions, adapters (fake fetch), tools, lifecycle, watchdog.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
