# Feature 25 — Workspace agent on OpenAI

**Depends on 18.**

## Goal
The workspace agent (feature 18) is one agent the whole team hands issues to,
running on the organization's own API key. Today that key must be Anthropic's.
A team that pays OpenAI should get the same agent on **OpenAI's Agents API**:
the Codex harness in an OpenAI-hosted sandbox, billed per token to the
organization's OpenAI account.

Everything people see stays the same: an admin connects it once, any member
assigns it, it claims the issue over Kanso's MCP server, works on a branch,
asks on the issue when it needs a person, and Kanso opens the pull request.
Only the runtime behind it changes. A workspace still has **one** workspace
agent, on either provider.

## What maps to what

| | Claude Managed Agents (18) | OpenAI Agents API (25) |
|---|---|---|
| Agent definition | `beta.agents.create`, versioned | `beta.agents.create` (saved agent); updates apply to new sessions |
| Sandbox | Environment object, `cloud`, limited networking with package managers | Per session: `openai_hosted`, `medium` container, `restricted` network with an allowlist (below) |
| Kanso MCP credential | Vault, `static_bearer` for Kanso's MCP URL | Same: workspace vault, `static_bearer` for Kanso's MCP URL |
| Repository | `github_repository` resource with a push-only token (Anthropic's git proxy holds it) | A per-run vault credential of type `environment_variable` (OpenAI's proxy holds it); the agent clones with a script Kanso puts in the sandbox (below) |
| Tool approvals | `permission_policy: auto`; approvals Kanso can't give are denied | `review: "auto_review"`; any approval request left for Kanso is denied |
| Run budget | `budget.max_list_cost` | `spend_control.limit` (USD cents) |
| Cost | `usage.list_cost` | `spend_control.consumed` (best effort, may lag) |
| Teammate's comment | `user.message` event | `agent.session.input.message` event, `Idempotency-Key` = the comment id |
| Cancel | `user.interrupt` event | `agent.session.input.cancel` event |
| Status | `idle` / `running` / `terminated` + stop reason | `idle` / `in_progress` / `requires_action` / `failed` + last turn's outcome |
| Watch link | Console session page | OpenAI dashboard logs (Agents tab), with the session id |

Kanso polls in both cases (feature 18 "Keeping runs in sync"): webhooks would
need registering per organization.

## GitHub access
The agent uses **Kanso's GitHub App** as in feature 18: per run, a token for
the issue's one repository with `contents: write` only, renewed once it's 30
minutes old. Kanso opens the pull request itself with a second token that
can only open pull requests. No token is stored.

The token never enters the sandbox:

- Each run gets its **own vault** with one `environment_variable` credential:
  `secret_name` `KANSO_GIT_AUTH`, allowed only for `github.com`. The sandbox
  sees a placeholder; OpenAI's proxy swaps in the real value on HTTPS requests
  to `github.com`.
- GitHub's git endpoints accept only **Basic** auth
  (`base64("x-access-token:" + token)`), not Bearer, and the proxy can only
  swap a placeholder that appears unchanged in a header. So the secret value
  Kanso stores is the **already-encoded Basic credential**, and git sends
  `Authorization: Basic $KANSO_GIT_AUTH` through `http.extraHeader`.
- Kanso puts `/workspace/.kanso/checkout.sh` into the sandbox (an inline
  file): it configures that header for `https://github.com/` only, sets the
  commit author, and clones the repository at the base branch into
  `/workspace/repo` if it isn't there. The first message tells the agent to run
  it. It contains no secret.
- **Renewal** updates the run vault's credential (same secret name, new
  value), on the same triggers as feature 18: the agent calling Kanso's MCP
  server, a reconcile, a forwarded comment.
- When the run ends, its vault is deleted (best effort). The workspace vault
  stays.

### Sandbox network
`restricted`, with exact hosts only (the API takes no wildcards):

- `github.com` (git), `codeload.github.com`, `objects.githubusercontent.com`
- package registries: `registry.npmjs.org`, `registry.yarnpkg.com`,
  `pypi.org`, `files.pythonhosted.org`, `proxy.golang.org`,
  `sum.golang.org`, `crates.io`, `static.crates.io`, `index.crates.io`,
  `rubygems.org`, `repo.maven.apache.org`

The Kanso MCP server is reached by OpenAI's service, not from the sandbox
(`connection_origin: "service"`), so it isn't on the list.

## Setup (Settings → Agents → Workspace agent)
The workspace agent card gains a **Provider** choice: Anthropic (feature 18)
or OpenAI. For OpenAI:

| Field | Notes |
|---|---|
| Name | As in feature 18 |
| OpenAI API key | From the OpenAI Platform; billed per token to that organization. The key's project needs the Agents API and vault permissions |
| Model | **GPT-6 Astra** (default, best results) or **GPT-6.1 Sol** (cheaper) |
| Monthly limit, per-run limit | As in feature 18 ($100 and $25 by default) |

Saving checks the key with a cheap call (listing saved agents, so a key
without Agents API access is refused at once), then **provisions**: the saved
agent (model, Kanso's instructions, the Kanso MCP tool) and the workspace vault
holding a Kanso agent token for the MCP server. Their ids go in the encrypted
config. Changing the key provisions afresh; changing the model, or a newer
Kanso definition, updates the saved agent (new sessions pick it up). Kanso
never deletes the saved agent or the workspace vault; removing the workspace
agent leaves them for the admin.

Switching an existing workspace agent from one provider to the other isn't an
edit: remove it and connect the other (its runs and history stay).

## A run
As feature 18, except:

1. **Session**: the saved agent, a new `openai_hosted` environment (network
   above, `checkout.sh`), `vault_ids: [workspace vault, run vault]`,
   `review: "auto_review"`, `spend_control: { limit: budget }`, metadata
   (`kansoRunId`, issue, workspace), and the first message: work on the issue,
   run `bash /workspace/.kanso/checkout.sh`, then call `claim_issue`.
2. Kanso's instructions to the agent are feature 18's, adapted: the repository
   is in `/workspace/repo` once the script ran; if a push is refused for
   authentication, call `get_issue` (which renews access) and push again.

### Keeping runs in sync
| Session | Run |
|---|---|
| `in_progress` | no change |
| `idle`, run RUNNING | NEEDS_INPUT ("Stopped and is waiting for a reply") |
| `idle`, run DISPATCHED (never claimed) | FAILED: "Stopped without claiming the issue" |
| `idle` or any, spend ≥ budget | FAILED: "Reached its $25 run limit" |
| `requires_action` | Approval requests are denied with feature 18's message; anything else fails the run ("Needed something Kanso can't provide") |
| `failed` | FAILED: "The session failed" (with OpenAI's error text when it's short and contains no key) |
| `idle`, run PR_OPEN | no change (waiting for review) |

Failures apply only before a PR is open, as in feature 18. Each reconcile
records `spend_control.consumed` as the run's cost.

## Data
- `AgentKind.OPENAI_API`.
- Config (encrypted): `apiKey`, `model` (`gpt-6-astra` | `gpt-6.1-sol`),
  `monthlyLimitCents`, `runLimitCents`, `openaiAgentId`, `vaultId`,
  `vaultTokenId`, `definitionVersion`.
- `AgentRun`: reuses `externalSessionId`, `sessionUrl`, `costCents`,
  `budgetCents`, `syncedAt`, `githubTokenAt`. The run vault's ids go in a new
  `runVaultId String?` and `runCredentialId String?`.
- "Workspace agent" means `kind in (CLAUDE_API, OPENAI_API)` everywhere feature
  18 checked `CLAUDE_API` (one per workspace, any member can assign it, comment
  forwarding, `open_pull_request`, spend, interrupts, reconcile). One helper,
  `isWorkspaceAgentKind`, so a future provider is one line.

## Code
- `lib/agents/openai-api-client.ts`: the per-key OpenAI client (swappable in
  tests) and safe error descriptions.
- `lib/agents/openai-api.ts`: definition and instructions, provisioning, run
  vault, starting a session, reconcile, renewal, comment forwarding, cancel.
- `lib/agents/workspace-agent.ts`: the provider-neutral entry points the rest
  of Kanso calls (`startWorkspaceSession`, `reconcileRun`,
  `reconcileActiveRuns`, `renewGitHubAccess`, `forwardComment`,
  `interruptRunSessions`), choosing Claude or OpenAI by the agent's kind.

## Out of scope
- Codex cloud on a person's ChatGPT plan (feature 19).
- Self-hosted sandboxes, environment templates, pre-warmed sandboxes.
- Streaming the agent's work into Kanso (the dashboard link shows it).
- Moving a workspace agent between providers in place.

## Tests (Vitest, fake OpenAI client and fake GitHub)
- Setup: a bad key is refused; provisioning creates the saved agent and the
  workspace vault with the MCP credential; the key is never returned; members
  get 403; a second workspace agent (either provider) is refused (409).
- Dispatch: the session gets the saved agent, `openai_hosted` with the
  restricted hosts and `checkout.sh`, both vaults, `auto_review`, the budget;
  the run vault's credential holds the Basic-encoded push token for
  `github.com` only; `checkout.sh` holds no token.
- Monthly limit enforced across active runs, as in feature 18.
- Reconcile: each row of the table; cost recorded from `consumed`; approval
  requests denied.
- Renewal updates the run credential once it's 30 minutes old.
- A member's comment is sent with the comment id as idempotency key and
  resumes a NEEDS_INPUT run; a guest's isn't.
- Cancelling a run sends a cancel event and deletes the run vault.
- `open_pull_request` works for the OpenAI workspace agent.

## Acceptance
- An admin connects the workspace agent with an OpenAI API key and model; a
  member assigns an issue; a session starts with the repository reachable only
  through the proxy-held credential; the agent claims, works, pushes, and
  Kanso opens the PR.
- Comments reach the session; spend limits hold; the issue shows the run's
  cost and a link to OpenAI's dashboard.
- Everything that worked for the Claude workspace agent still does.
- `pnpm lint`, `tsc --noEmit`, `pnpm test` and `pnpm build` are clean.

## Verification still needed with a real OpenAI account
These can't be tested without one, and are the first things to check:
1. That the `environment_variable` placeholder is swapped in a git
   `http.extraHeader` the same way as in a curl header.
2. That updating the run credential's value reaches a running session without
   changing the placeholder.
3. That `auto_review` leaves nothing for Kanso to approve in normal runs.
