# Kanso (formerly Lite Jira) — Phase 2 Master Plan · Teams, GitHub & AI agents

Phase 1 ([`PLAN.md`](PLAN.md), features 00–05) shipped a solo Kanban app. Phase 2
turns it into a Jira-style tracker for **teams and solo freelancers alike**, with
first-class **GitHub** integration and **AI agents as teammates**: agents can read
and update work over MCP, and tasks can be dispatched to Claude Code / Codex cloud
sessions that open PRs.

As in phase 1, each **feature** below is sized to be handed to one sub-agent, with
a spec at `docs/features/NN-*.md` written before work starts.

---

## 1. Product summary

| Aspect | Decision |
|--------|----------|
| Users | Teams **and** solo. Signup auto-creates a personal workspace; solo users never see team UI. Freelancers can run one workspace per client and invite the client as a guest. |
| Hosting | Hosted by us (single deployment, Vercel + Neon). Self-hosting not a goal for now. |
| Work items | **Issues** (renamed from tasks) with keys (`WEB-42`), types (Epic · Story · Task · Bug · Sub-task), subtasks, epics, assignee (person or agent), estimate, comments, activity history. |
| Project modes | Per project: **Kanban** (continuous flow) or **Scrum** (backlog + sprints). Sprint schema ships in the foundation; sprint UI comes later. |
| GitHub | **GitHub App** (repo-scoped, webhooks): import assigned issues, two-way status sync, PR linking, auto-move on merge. |
| Agent access | **Remote MCP server** (primary) + personal API tokens. WebMCP later as a thin adapter over the same tools. |
| Agent execution | Assign an issue to an **agent member** → dispatched to Claude Code cloud (scheduled-task API trigger) or Codex cloud (`@codex` mention, beta). Agents report back via MCP; PRs link via the GitHub App. |
| In-app AI | Claude by default. Paid by: platform key (covered by our plans) · workspace's own Anthropic key (BYOK) · Sign in with ChatGPT (OpenAI plan). |
| Out of scope (phase 2) | Billing/plans (Stripe), self-hosting, mobile apps, email notifications beyond invites, attachments. |

### AI billing — what is and isn't allowed

| Usage | Paid by | Why |
|-------|---------|-----|
| Claude Code cloud agent runs | User's **Claude subscription** | Runs inside Anthropic's own product under the user's account; we only fire their scheduled-task trigger (a token scoped to firing that one task). |
| Codex cloud agent runs | User's **ChatGPT plan** | Started by an `@codex` mention made as the user on GitHub. |
| In-app AI features (quick-add, breakdown, summaries…) | Platform API key · workspace BYOK Anthropic key · Sign in with ChatGPT | Anthropic **forbids** third-party apps from using Claude.ai/Free/Pro/Max credentials or offering Claude.ai login. We must never ask for, store, or proxy Claude.ai credentials. Sign in with ChatGPT is an official OpenAI program (beta, partner rollout — requires applying). |

## 2. Tech stack additions

Phase 1 stack stays (Next.js 16, React 19, Prisma 6, Postgres, Better Auth,
Tailwind v4 + shadcn/ui, TanStack Query, dnd-kit, Zod). Additions:

- **Better Auth OAuth Provider plugin** (+ JWT plugin) — makes the app an OAuth
  2.1 authorization server for MCP clients. (The older Better Auth `mcp` plugin is
  deprecated; do not use it.)
- **MCP TypeScript SDK** — Streamable HTTP server at `/api/mcp`.
- **Octokit** (`@octokit/app`, `@octokit/webhooks`) — GitHub App auth + webhook
  verification.
- **Anthropic SDK** (and OpenAI SDK for Sign in with ChatGPT) — in-app AI only.
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
ProjectRepo          projectId, repoFullName, importAssigned Bool, statusSync Bool
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
| 9 | **13 — Codex adapter (beta)**: dispatch via `@codex` mention posted as the user on the linked GitHub issue; status from GitHub events | 11, 12 |
| 10 | **14 — In-app AI**: provider abstraction (platform key / BYOK / Sign in with ChatGPT), natural-language quick add, break-down-into-subtasks, GitHub import triage, summaries, "ask your board" | 07 |
| 10 | **15 — Sprints UI**: backlog, sprint planning, start/complete, burndown, velocity (Scrum projects) | 09 |
| 10 | **16 — My Work & saved filters**: cross-project home, saved filters, issue links UI (blocks/blocked by) | 09 |
| later | Automation rules, WebMCP adapter, notifications, attachments, recurring issues, templates, calendar view, billing | — |

```
Wave 5:  [06 Foundation v2]
              │
Wave 6:  [07 Issue model] ‖ [08 Members & invites]
              │
Wave 7:  [09 Design system & redesign]
              │
Wave 8:  [10 MCP + tokens] ‖ [11 GitHub App]
              │                 │
Wave 9:  [12 Agents & dispatcher] → [13 Codex adapter]
              │
Wave 10: [14 In-app AI] ‖ [15 Sprints UI] ‖ [16 My Work]
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

### 13 — Codex adapter (beta)
No public Codex cloud API exists. Dispatch by posting `@codex <instructions> (WEB-42)`
on the linked GitHub issue **as the user** (GitHub App user-to-server token).
Requires the issue to have a GitHub link and the user to have Codex cloud set up
for the repo. Known reliability issues upstream (openai/codex#42098) — surface
failures clearly; swap to an official API if OpenAI ships one.

### 14 — In-app AI
Provider interface with three implementations: platform Anthropic key,
workspace BYOK Anthropic key (encrypted), Sign in with ChatGPT (pending OpenAI
partner approval — apply early). Default model: latest Claude. Every AI write
is a suggestion the user confirms, then goes through services like any edit.

## 7. Open risks

| Risk | Mitigation |
|------|-----------|
| Claude scheduled-task fire API is a research preview | Adapter isolation; pin beta header; generic MCP agent as fallback. |
| Codex `@codex` dispatch is unreliable | Labeled beta; clear failure states; watchdog. |
| Sign in with ChatGPT needs partner approval | Apply early; BYOK/platform key work without it. |
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
