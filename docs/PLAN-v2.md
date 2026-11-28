# Kanso (formerly Lite Jira) — Phase 2 Master Plan · Teams, GitHub & AI agents

Phase 1 ([`PLAN.md`](PLAN.md), features 00–05) shipped a solo Kanban app. Phase 2
turns it into a Jira-style tracker for **teams and solo freelancers alike**, with
first-class **GitHub** integration and **AI agents as teammates**: agents can read
and update work over MCP, and tasks can be dispatched to Claude Code / Codex cloud
sessions that open PRs.

As in phase 1, each **feature** below is sized to be handed to one sub-agent, with
a spec at `docs/features/NN-*.md` written before work starts.

### Positioning (November 2026)
**The open-source issue tracker where your team's AI agents, on the AI plans
you already pay for, share one project context.**

Linear and Cursor already give agents shared context (Linear's coding agent
with repository environments and guidance, billed in Linear credits; Cursor's
shared Projects, launched 10 Nov 2026). We don't try to match Linear's breadth
(initiatives, Slack, insights, triage AI). We win on what they can't say:

| | Kanso |
|---|---|
| Open | Open source and self-hostable; no lock-in to our hosting. |
| Your AI, your plan | Agents run on the person's own Claude or ChatGPT subscription (Claude Code, Codex), or the workspace's key for any provider. Kanso adds no per-run charge. |
| Any vendor | One project context and one agent loop for every agent: Claude, Codex, Gemini, Cursor, any MCP client (features 23–27). |
| Solo to team | Unlimited issues; a workspace per client for freelancers. |

Open source alone isn't the edge (Plane and others exist); the combination is.

---

## 1. Product summary

| Aspect | Decision |
|--------|----------|
| Users | Teams **and** solo. Signup auto-creates a personal workspace; solo users never see team UI. Freelancers can run one workspace per client and invite the client as a guest. |
| Hosting | Hosted by us (single deployment, Vercel + Neon). The code is open source, so self-hosting is possible; a polished self-host path (docs, one-command deploy) comes later. |
| Work items | **Issues** (renamed from tasks) with keys (`WEB-42`), types (Epic · Story · Task · Bug · Sub-task), subtasks, epics, assignee (person or agent), estimate, comments, activity history. |
| Project modes | Per project: **Kanban** (continuous flow) or **Scrum** (backlog + sprints). Sprint schema ships in the foundation; sprint UI comes later. |
| GitHub | **GitHub App** (repo-scoped, webhooks): import assigned issues, two-way status sync, PR linking, auto-move on merge. |
| Agent access | **Remote MCP server** (primary) + personal API tokens. WebMCP later as a thin adapter over the same tools. |
| Agent execution | Assign an issue to an **agent member** → dispatched to Claude Code cloud (scheduled-task API trigger) or Codex cloud (`@codex` mention, beta). Agents report back via MCP; PRs link via the GitHub App. |
| In-app AI | Any provider (feature 24): Anthropic by default, OpenAI, Google Gemini, Mistral, xAI, DeepSeek, Groq, or a custom OpenAI-compatible endpoint. Paid by: the workspace's own key for that provider (BYOK) · platform key (covered by our plans) · later, Sign in with ChatGPT (each person's ChatGPT plan, once OpenAI approves). |
| AI apps | People use Kanso from the AI app they already pay for (ChatGPT, Claude, Codex, Gemini CLI, Cursor…) over MCP (feature 23). No provider lock-in anywhere. |
| Out of scope (phase 2) | Billing/plans (Stripe), self-hosting, mobile apps, email notifications beyond invites, attachments. |

### AI billing — what is and isn't allowed

| Usage | Paid by | Why |
|-------|---------|-----|
| Claude Code cloud agent runs | User's **Claude subscription** | Runs inside Anthropic's own product under the user's account; we only fire their scheduled-task trigger (a token scoped to firing that one task). Only that user starts it (feature 17); a team shares no account. |
| Workspace agent runs (feature 18) | Workspace's **Claude API key** | Pay-per-token on the organization's own API account; no Claude.ai credentials involved. |
| Codex cloud agent runs | User's **ChatGPT plan** | Started by an `@codex` mention made as the user on GitHub. |
| Using Kanso from an AI app over MCP (feature 23) | The person's **own AI plan** (ChatGPT, Claude, Gemini…) | Their app calls Kanso; Kanso calls no model and pays nothing. |
| Workspace agent on OpenAI (feature 25) | Workspace's **OpenAI API key** | Agents API, pay-per-token on the organization's own account. |
| In-app AI features (quick-add, breakdown, summaries…) | Workspace BYOK key for any supported provider · platform API key · later, Sign in with ChatGPT | Only API keys and official OAuth programs. Anthropic **forbids** third-party apps from using Claude.ai/Free/Pro/Max credentials or offering Claude.ai login, and the same rule applies to every provider: we never ask for, store, or proxy a person's consumer AI account credentials. Sign in with ChatGPT is OpenAI's official program; ChatGPT plan usage is open to open-source, locally hosted apps, but a hosted app like Kanso needs OpenAI's approval ([interest form](https://openai.com/form/sign-in-with-chatgpt-interest/)). |

## 2. Tech stack additions

Phase 1 stack stays (Next.js 16, React 19, Prisma 6, Postgres, Better Auth,
Tailwind v4 + shadcn/ui, TanStack Query, dnd-kit, Zod). Additions:

- **Better Auth OAuth Provider plugin** (+ JWT plugin) — makes the app an OAuth
  2.1 authorization server for MCP clients. (The older Better Auth `mcp` plugin is
  deprecated; do not use it.)
- **MCP TypeScript SDK** — Streamable HTTP server at `/api/mcp`.
- **Octokit** (`@octokit/app`, `@octokit/webhooks`) — GitHub App auth + webhook
  verification.
- **Anthropic SDK** — the Claude agents (features 17, 18).
- **AI SDK** (`ai` v7 + `@ai-sdk/*` provider packages) — in-app AI on any provider (feature 24).
- **OpenAI SDK** — the workspace agent on OpenAI's Agents API (feature 25).
- **Encryption at rest** for stored secrets (agent trigger tokens, BYOK keys):
  AES-256-GCM with `ENCRYPTION_KEY` env var, helper in `lib/crypto.ts`.
- **Test runner** (Vitest) — phase 1 has no tests; phase 2 services must be
  covered (permissions especially).

> AGENTS.md applies: this Next.js version differs from training data. Read
> `node_modules/next/dist/docs/` before writing route handlers, middleware, or
> caching code.

## 3. Architecture

The core change: **all business logic moves into a service layer** that every
entry point calls. Permission checks, validation, and activity logging live there
exactly once.

```
                ┌──────────── entry points (thin) ────────────┐
 Web UI ─► app/api/* REST │ /api/mcp (MCP) │ GitHub webhooks │ Agent dispatcher │ (later) WebMCP
                └──────────────────────┬───────────────────────┘
                                       ▼
                          lib/services/*   (ctx, input) → result
                    authorize(ctx, action, resource) · Zod validate
                    write + Activity row in ONE transaction
                                       ▼
                                Prisma / Postgres
```

```
app/
  (auth)/…                         # unchanged
  (app)/[workspace]/…              # workspace-scoped pages (slug in URL)
      projects/[key]/board         # Kanban
      projects/[key]/list          # table view
      projects/[key]/backlog       # Scrum only (later)
      issues/[issueKey]            # full issue page (WEB-42)
      settings/{members,integrations,agents,tokens}
  api/…                            # REST, thin over services
  api/mcp/route.ts                 # MCP server (Streamable HTTP)
  api/github/webhooks/route.ts     # GitHub App webhooks
  .well-known/…                    # OAuth discovery metadata for MCP clients
lib/
  services/      # workspaces, members, projects, issues, comments, sprints,
                 # github, agents, ai — the ONLY place that writes data
  auth/          # session → Actor resolution (user | api token | oauth | agent)
  permissions.ts # role matrix + authorize()
  activity.ts    # recordActivity(tx, ctx, …)
  query/         # issue query language parser (shared by UI, MCP, saved filters)
  crypto.ts
  github/        # GitHub App client, webhook handlers, sync
  agents/        # dispatcher + adapters (claude-code, codex, mcp)
  mcp/           # tool definitions → services
```

### Service context contract (do NOT diverge)

```ts
type Actor =
  | { type: "user";   userId: string }
  | { type: "agent";  agentId: string; onBehalfOf: string }   // userId
  | { type: "github"; installationId: string }                // sync jobs
  | { type: "system" };

type Ctx = { actor: Actor; workspaceId: string; via: "web" | "mcp" | "api_token" | "github" | "dispatcher" };

// every service function:
async function updateIssue(ctx: Ctx, input: UpdateIssueInput): Promise<Issue>
```

- A missing or forbidden resource returns **404, not 403** (phase 1 rule, kept).
- An agent never has more access than `onBehalfOf`, and is additionally capped:
  no deleting projects/workspaces, no member/role changes, no integration changes.
- Every mutation writes an `Activity` row with the actor, in the same transaction.

## 4. Data model (sketch — Feature 06/07 finalize it in `schema.prisma`)

```
Workspace      id, name, slug (unique), personal Bool, createdAt
Membership     workspaceId, userId, role OWNER|ADMIN|MEMBER|GUEST      @@unique(workspaceId,userId)
Invite         workspaceId, email, role, tokenHash, expiresAt, acceptedAt
ProjectAccess  projectId, membershipId          # guests see only projects listed here

Project        (was Board) id, workspaceId, name, key "WEB" (unique per workspace),
               issueCounter Int, mode KANBAN|SCRUM, archivedAt
Column         + category TODO|IN_PROGRESS|DONE   # lets GitHub sync & agents know what "done" means
Issue          (was Task) id, projectId, number Int (@@unique projectId+number → key "WEB-42"),
               type EPIC|STORY|TASK|BUG|SUBTASK, title, description, acceptanceCriteria?,
               priority, dueDate, estimate Int?, position, columnId,
               parentId? (subtasks), epicId?, sprintId?,
               assigneeUserId? | assigneeAgentId?, reporterUserId,
               claimedByAgentId?, claimedAt?          # agent work lock
               source NATIVE|GITHUB, archivedAt
Label          (unchanged, project-scoped)
Comment        issueId, authorUserId? | authorAgentId?, body (Markdown), createdAt, editedAt
Activity       workspaceId, projectId?, issueId?, actorType USER|AGENT|GITHUB|SYSTEM,
               actorUserId?, actorAgentId?, action, data Json, createdAt
Sprint         projectId, name, goal?, startDate, endDate, state PLANNED|ACTIVE|CLOSED
IssueLink      fromIssueId, toIssueId, type BLOCKS|RELATES|DUPLICATES     # UI later

ApiToken       userId, workspaceId, name, tokenHash, scopes[], projectIds[]?, lastUsedAt, expiresAt, revokedAt

GitHubInstallation   workspaceId, installationId, accountLogin
GitHubUserLink       userId, githubUserId, login, encrypted user token   # acting "as the user"
ProjectRepo          projectId, repoFullName, importIssues ALL|ASSIGNED|OFF, statusSync Bool
GitHubIssueLink      issueId, repoFullName, number, nodeId, state, lastSyncedAt
PullRequestLink      issueId, repoFullName, number, url, state OPEN|MERGED|CLOSED, checks PENDING|PASS|FAIL

Agent          workspaceId, name, kind CLAUDE_CODE|CODEX|MCP, ownerUserId, configEncrypted Json, enabled
AgentRun       issueId, agentId, requestedByUserId, status QUEUED|DISPATCHED|RUNNING|NEEDS_INPUT|PR_OPEN|DONE|FAILED,
               externalSessionId?, sessionUrl?, prUrl?, error?, dispatchedAt, claimedAt, finishedAt

AiCredential   workspaceId, provider ANTHROPIC|OPENAI_SIWC, encrypted, createdBy   # later
```

**Migration of phase 1 data:** every existing user gets a personal workspace;
their boards become projects with an auto-derived key; tasks become issues of type
`TASK`, numbered by creation order; columns get a category (first = TODO, last =
DONE, rest = IN_PROGRESS).

### Roles

| Action | Owner | Admin | Member | Guest | Agent |
|--------|:-----:|:-----:|:------:|:-----:|:-----:|
| Read projects | ✓ | ✓ | ✓ | shared only | as owner user |
| Create/edit issues, comment | ✓ | ✓ | ✓ | comment only | ✓ |
| Assign issues to agents | ✓ | ✓ | ✓ | — | — |
| Create/archive projects, edit columns | ✓ | ✓ | ✓ | — | — |
| Delete projects | ✓ | ✓ | — | — | **never** |
| Members, invites, integrations, agents | ✓ | ✓ | — | — | **never** |
| Delete workspace | ✓ | — | — | — | **never** |

## 5. Features & execution waves

| Wave | Feature | Depends on |
|------|---------|-----------|
| 5 | **06 — Foundation v2**: workspaces, memberships, roles, `Ctx`/Actor, service layer + `authorize()`, Activity log, Vitest, phase 1 data migration, workspace-scoped routes | — |
| 6 | **07 — Issue model**: Board→Project, Task→Issue, keys, types, subtasks, epics, assignees, estimates, comments, column categories, Sprint/IssueLink schema, issue query language | 06 |
| 6 | **08 — Members & invites**: invite by email/link, roles UI, guests + project access, workspace switcher, create workspace | 06 |
| 7 | **09 — Design system & redesign**: typography, color tokens, spacing, dark mode, sidebar app shell, board, list view, issue page/panel, activity + comments UI, ⌘K command palette, keyboard shortcuts | 07, 08 |
| 8 | **10 — MCP server & API tokens**: `/api/mcp`, OAuth Provider plugin, discovery metadata, consent screen, personal API tokens UI, tool annotations, rate limits | 07 |
| 8 | **11 — GitHub App**: install + repo selection per project, user link, import assigned issues, webhooks, two-way status sync, PR linking + checks, auto-move on merge, "copy branch name" | 07 |
| 9 | **12 — Agents & dispatcher**: agent members, claim/lock, `AgentRun` lifecycle + watchdog, Claude Code adapter, generic MCP agent ("Ready for agent" column), agent UI (badges, watch-session link), outbound webhooks | 10, 11 |
| 9 | **13 — Guided setup** (done): Get started checklist, assignee shortcuts, step-by-step agent setup | 12 |
| 9 | **14 — Loading states** (done): skeletons and spinners | 09 |
| 9 | **15 — GitHub setup & agent repositories** (done): create the GitHub App from Integrations (manifest flow), runs name the issue's repository, Claude Code needs one | 11, 12 |
| 9 | **16 — GitHub sync & replies** (done): import all open issues (mode per repo), catch-up sync + daily cron, repo picker in New project and the project header, comment images, replies resume waiting agents, assignee filter | 11, 12, 15 |
| 9 | **17 — Personal agents** (done): each member connects their own Claude, only its owner starts a Claude Code agent, the person stays the assignee while their agent works the issue; a one-time claim code in the run message lets the run claim the issue from whichever Claude account its routine runs on | 12, 13, 16 |
| 10 | **18 — Workspace agent on the Claude API** (done): one agent for the whole workspace on the organization's Claude API key (billed per token), any member hands it work, comments in Kanso reach its running session | 12, 17 |
| 10 | **19 — Codex adapter (beta)**: dispatch via `@codex` mention posted as the user on the linked GitHub issue; status from GitHub events | 11, 12 |
| 11 | **20 — In-app AI** (done): workspace Claude API key or platform key (Sign in with ChatGPT left out for now), natural-language quick add ("Fill in"), break down into sub-issues, GitHub import triage, summaries, "Ask" on a project; every write is a suggestion the person accepts | 07 |
| 11 | **21 — Sprints** (done): Kanban or Scrum per project; backlog with sprint sections, sprint planning, start/complete with carry-over, the board scoped to the active sprint, burndown rebuilt from history, velocity; `sprint:` queries and MCP | 09 |
| 11 | **22 — My Work & saved filters** (done): cross-project home, issues page with saved filters (personal or shared), issue links (blocks/blocked by, relates, duplicates) with a Blocked chip and `is:blocked` | 09 |
| 12 | **23 — Connect your AI** (done; checks with the real apps on a deployed preview still to do): a "Connect your AI" page with setup for ChatGPT, Claude, Codex, Claude Code, Gemini CLI, Cursor and VS Code; ChatGPT verified end to end against our OAuth; an MCP tool contract test so tool changes can't silently break ChatGPT | 10 |
| 12 | **24 — In-app AI on any provider** (done): in-app AI on the AI SDK; admins pick provider (Anthropic, OpenAI, Gemini, Mistral, xAI, DeepSeek, Groq, custom OpenAI-compatible) and model with the workspace's own key | 20 |
| 13 | **25 — Workspace agent on OpenAI** (done; first run with a real OpenAI account still to verify): the workspace agent (18) made provider-agnostic, with an OpenAI Agents API backend (Codex harness, hosted sandbox) on the workspace's OpenAI key | 18 |
| 13 | **26 — Sign in with ChatGPT**: each person's ChatGPT plan pays for their in-app AI. Waits on OpenAI's approval for hosted apps | 24 |
| 12 | **27 — Project context** (done): a brief per project plus sourced decisions, constraints, conventions and vocabulary, served to every agent (`claim_issue`, `get_project_context`) and to in-app AI; agents propose what they learned and people accept; overlap warnings when two pieces of work change the same files | 10, 11, 12 |
| later | Automation rules, WebMCP adapter, notifications, file attachments, recurring issues, templates, calendar view, billing | — |

```
Wave 5:  [06 Foundation v2]
              │
Wave 6:  [07 Issue model] ‖ [08 Members & invites]
              │
Wave 7:  [09 Design system & redesign]
              │
Wave 8:  [10 MCP + tokens] ‖ [11 GitHub App]
              │                 │
Wave 9:  [12 Agents & dispatcher] → [13 Guided setup] ‖ [14 Loading] ‖ [15 GitHub setup] → [16 GitHub sync & replies] → [17 Personal agents]
              │
Wave 10: [18 Workspace agent (Claude API)] ‖ [19 Codex adapter]
              │
Wave 11: [20 In-app AI] ‖ [21 Sprints UI] ‖ [22 My Work]
              │
Wave 12: [23 Connect your AI] ‖ [24 In-app AI on any provider] ‖ [27 Project context]
              │
Wave 13: [25 Workspace agent on OpenAI] ‖ [26 Sign in with ChatGPT (on approval)]
```

10 and 11 do not depend on 09 and may start once 07 lands if we want them
earlier; the order above keeps the UI from being designed twice.

## 6. Key feature notes

### 09 — Redesign
**Product name: Kanso** (renamed from Lite Jira; mark = an open ensō circle).

Agreed direction ("A · Precision", Linear-like, dense, dark-first, both themes):
- **Type:** Inter Tight (headings 24/19/15, weight 600), Inter (UI: 13 body,
  12 meta), JetBrains Mono (11: issue keys, PR numbers, timers). Replaces the
  current setup, which renders in Times New Roman because `globals.css` defines
  `--font-sans: var(--font-sans)` (self-reference) — fix as part of this feature.
- **Color (dark / light):** bg `#0E0F11`/`#FFFFFF`, sidebar `#0A0B0D`/`#FAFAFB`,
  surface `#18191D`/`#FFFFFF`, border `#24262B`/`#E3E4E8`, text
  `#ECEDEF`/`#16171A`, muted `#8E9199`/`#5F626A`, accent `#5E62E8`/`#5357DD`,
  accent text `#A9ACFF`/`#4045C2`.
- **Iconography:** Lucide 13–15px stroke 2 everywhere (nav, toolbar, card meta);
  custom status icons driven by column category (dashed / half / three-quarter /
  check), bar-style priority icons with an orange "!" for urgent, colored
  issue-type icons (epic, story, task, bug, sub-task).
- **Signature elements:** live agent states on cards and in the issue panel
  (pulsing dot, timer, "Watch session"), PR + checks inline on cards, colored
  avatars, label dots, ⌘K search, filter chips, sprint progress in the toolbar.
- **Shape:** radius 5 controls · 7 cards · 8 panels; 4px spacing grid.

Mockups (board + tokens sheet) live in the design canvas shared in the planning
session. Deliverable: tokens in `globals.css`, updated shadcn theme, and every
phase 1 screen reworked.

### 10 — MCP server

Tools (each annotated `readOnlyHint` / `destructiveHint`; all go through services):

| Tool | Kind |
|------|------|
| `whoami`, `list_workspaces`, `list_projects`, `get_project` (columns + categories, labels, members, agents) | read |
| `search_issues(query)` — query language, e.g. `assignee:me status:todo type:bug label:auth "login"` | read |
| `get_issue(key)` — incl. subtasks, comments, links, PRs, activity | read |
| `get_my_work` | read |
| `create_issue`, `update_issue`, `move_issue`, `create_subtasks`, `assign_issue` | write |
| `add_comment`, `link_pull_request` | write |
| `claim_issue`, `release_issue`, `report_progress` | write (agent loop) |
| `bulk_update_issues` | write — asks for confirmation (elicitation) |
| delete project / workspace, member or integration changes | **not exposed** |

Resources: `issue://WEB-42`, `project://WEB/workflow`. Prompts: break down epic,
plan sprint, write standup.

Auth: OAuth 2.1 via Better Auth OAuth Provider (Client ID Metadata Documents; no
implicit Dynamic Client Registration), resource-bound tokens. API tokens: hashed,
scoped (read / write, optional project list), revocable, `lastUsedAt` shown.

### 11 — GitHub App
- One app for production, a separate dev app for local (webhooks via a tunnel
  such as smee.io) — the user must create both on GitHub (we provide a manifest).
- Import: issues assigned to a linked user in selected repos → issues (`source=GITHUB`),
  labels mapped, link back to GitHub.
- Sync: issue moved to a `DONE` column ⇄ GitHub issue closed; reopen both ways.
- PRs: branch name, title, or body containing `WEB-42` → `PullRequestLink`;
  checks status on the card; merged → issue moves to the project's first `DONE`
  column (configurable).

### 12 — Agents & dispatcher

```
Assign WEB-42 to "Claude" ─► AgentRun QUEUED ─► adapter.dispatch()
  Claude Code: POST user's scheduled-task /fire URL with text "WEB-42" ─► sessionUrl saved, DISPATCHED
  agent ─MCP─► claim_issue → RUNNING (card badge "Claude working", ▶ Watch session)
        ─MCP─► add_comment / report_progress
        ─git─► branch web-42-…, PR ─► GitHub App links PR ─► PR_OPEN, card → Review
  human merges ─► DONE, card → Done
  not claimed within N min ─► FAILED, issue released, requester notified in-app
```

- **Claude Code adapter:** the user creates a scheduled task at claude.ai with
  their repos, our MCP server as a connector, and our provided prompt (which
  explicitly tells the agent to act on the issue key in the fire payload, since
  fire text arrives wrapped as untrusted data). They paste the **Fire URL +
  token** into Settings → Agents. Token stored encrypted. Fire endpoint is a
  research preview behind a dated beta header — isolate it in the adapter.
- **Generic MCP agent:** any MCP client polls a "Ready for agent" column,
  claims, and reports back. No provider-specific code.
- **Safety:** only members can dispatch; imported GitHub content is labeled
  untrusted in what we hand to agents; agents push branches only; merge is
  always human.

### 18 — Workspace agent on the Claude API
Subscriptions are per person (Anthropic's consumer terms forbid sharing an
account), so an agent the whole team uses must run on the organization's
Claude API key: Managed Agents, billed per token to the workspace. Any member
hands it work; it asks through `report_progress`, and a comment in Kanso is
sent to its idle session as a user message, so answering needs no Claude
account. The key is stored encrypted, shown once, never logged; a spend cap per
workspace.

### 19 — Codex adapter (beta)
No public Codex cloud API exists. Dispatch by posting `@codex <instructions> (WEB-42)`
on the linked GitHub issue **as the user** (GitHub App user-to-server token).
Requires the issue to have a GitHub link and the user to have Codex cloud set up
for the repo. Known reliability issues upstream (openai/codex#42098) — surface
failures clearly; swap to an official API if OpenAI ships one.

### 20 — In-app AI
Provider interface with three implementations: platform Anthropic key,
workspace BYOK Anthropic key (encrypted), Sign in with ChatGPT (pending OpenAI
partner approval — apply early). Shipped with the first two; Sign in with
ChatGPT is left out until OpenAI approves hosted apps
(docs/features/20-in-app-ai.md). Default model: latest Claude. Every AI write
is a suggestion the user confirms, then goes through services like any edit.

### 23–26 — Many providers
Kanso works with the AI people already pay for, at three levels:
- **Their AI app uses Kanso** (23): any MCP client, on their own plan. ChatGPT's
  full MCP (read and write) is on Business and Enterprise/Edu; Pro is read-only
  and Plus has none, so Plus users are pointed to Codex.
- **Kanso's in-app AI uses their provider** (24): one AI SDK call path, a
  provider catalog in `lib/ai/catalog.ts`, the workspace's key.
- **Their provider runs Kanso's workspace agent** (25): Claude Managed Agents
  or OpenAI's Agents API behind one adapter interface.

Specs: [`23-connect-your-ai.md`](features/23-connect-your-ai.md),
[`24-multi-provider-ai.md`](features/24-multi-provider-ai.md),
[`25-workspace-agent-openai.md`](features/25-workspace-agent-openai.md); 26 is
written before it starts.

### 27 — Project context
The shared layer every agent works from, whoever makes the agent. People write a
brief; agents propose decisions, constraints, conventions and terms when they
finish; only what a person accepts is served to other agents, so an injected
GitHub issue can't spread through it. Overlap warnings use linked PRs' changed
files and the files agents say they plan to touch. Spec:
[`27-project-context.md`](features/27-project-context.md).

## 7. Open risks

| Risk | Mitigation |
|------|-----------|
| Claude scheduled-task fire API is a research preview | Adapter isolation; pin beta header; generic MCP agent as fallback. |
| Codex `@codex` dispatch is unreliable | Labeled beta; clear failure states; watchdog. |
| Sign in with ChatGPT needs partner approval (hosted apps aren't covered by the open-source program) | Interest form submitted early; BYOK on any provider and the platform key work without it. |
| ChatGPT freezes a snapshot of our MCP tools; a breaking tool change fails silently until an admin refreshes | MCP tool contract test (feature 23); breaking changes called out in release notes. |
| ChatGPT full MCP is limited to Business/Enterprise plans | Say so on the Connect page; point Plus users to Codex. |
| A custom AI endpoint URL could target internal services | HTTPS + public host, re-checked against the resolved address per request, no redirects (feature 24). |
| Project context is served to every agent, so it's a prime prompt-injection target | Only entries a person accepted are served; agents can only propose (feature 27). |
| Provider model ids and prices change often | Curated catalog checked against provider docs on each bump; "Other model…" for new ids; no price → no cost shown. |
| Prompt injection via imported GitHub issues | Untrusted labeling, member-only dispatch, branch-only pushes, human merge. |
| GitHub webhooks need a public URL | Vercel for prod; tunnel + dev app locally; polling fallback. |
| Large rename (Board→Project, Task→Issue) | Done once in 07 with a migration; no compatibility aliases kept. |

## 8. Conventions (additions to PLAN.md §7)

- Business logic only in `lib/services/*`; route handlers, MCP tools, webhook
  handlers and adapters are thin.
- Every service has Vitest coverage for its permission rules.
- Secrets never logged; stored encrypted; shown once at creation.
- Definition of done per feature: acceptance criteria pass + `pnpm lint`,
  `tsc --noEmit`, `pnpm test`, `pnpm build` clean.
