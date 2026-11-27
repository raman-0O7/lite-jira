# Feature 27 — Project context

**Depends on 10, 11, 12.** Works better with 23 (more agents connected) and
24 (the AI draft uses the workspace's provider).

## Goal
An agent that picks up an issue reads the issue, its comments and the
repository. What it doesn't see is everything the team already knows about the
project: why the auth flow works the way it does, that the API must stay
backward compatible, that "account" means the billing entity and not the
login. A person learns this over weeks. Each agent run starts from zero and can
build exactly what the ticket says and still get it wrong.

Linear (repository environments with custom guidance) and Cursor (shared
Projects) both answer this inside their own agents. Kanso's answer is for
**every agent the team uses, from any vendor**: one project context, served to
every agent that touches the project, kept current by the agents themselves
and accepted by people.

Three parts:

1. **The brief**: a Markdown page per project that people write and edit.
2. **Context entries**: short, sourced facts (decisions, conventions,
   constraints) that agents and people **propose** at the end of their work,
   and people **accept**. The newest replaces the old, so agents get one
   current answer instead of three conflicting ones.
3. **Overlap warnings**: when two pieces of work (agents or people) are
   changing the same files in the same repository, both sides find out before
   the merge conflict does.

## Where context reaches agents

| Agent | How it gets the context |
|---|---|
| Any agent working an issue (Claude Code, the workspace agent, MCP agents) | **`claim_issue`** returns it, with a rule to follow it |
| Any MCP client (ChatGPT, Claude, Codex, Cursor…) | **`get_project_context`** tool, and the `project://{workspace}/{key}/context` resource |
| Kanso's in-app AI (Fill in, Break down, Triage, Ask) | Included in the prompt, inside the same size budget |

Tools as well as a resource, because not every client reads resources (ChatGPT
uses tools). One renderer produces the Markdown for all of them.

**Repository files stay the code-level guidance.** `AGENTS.md`, `CLAUDE.md`,
`skills.md` and the like describe how to work in the code; agents already read
them. The project context covers what lives above the code: product decisions,
constraints, vocabulary, what was tried and why. The brief's empty-state text
says so, so teams don't copy their `AGENTS.md` in.

### What an agent receives
```markdown
# Project context: Web app (WEB)
Accepted by the team. Follow it; if your work changes any of it, propose an update with propose_context.

## Brief
…the brief, as written…

## Decisions
- Sessions stay cookie-based; no JWTs in the browser. (WEB-112, PR acme/web#481 · accepted by Priya, 3 Oct)
- …

## Constraints
- Public API v1 must stay backward compatible until 2027-06. (WEB-90 · accepted by Sam, 12 Sep)

## Conventions
- …

## Vocabulary
- "Account" = the billing entity, not a login. (accepted by Priya, 1 Sep)

_4 older entries not shown: call get_project_context with page 2._
```

- **Size budget: 30,000 characters** (about 8k tokens). The brief comes first,
  then accepted entries newest first per section, until the budget runs out;
  a footer says how many were left out and how to page.
- **Only what people accepted is served.** Proposals never reach other agents
  (see "Safety").

## The brief
- One per project, Markdown, at most **20,000 characters**.
- New projects get an empty brief with a template in the placeholder:
  *What this project is · Architecture in a paragraph · Things that must not
  break · Words we use*.
- **History.** Each save keeps a revision (who, when, the full text). The
  Context page shows the history and can restore an old revision (restoring is
  a new save).
- **AI draft** (when in-app AI is on, features 20/24): "Draft from this project"
  suggests a brief from the project's issues, finished work and accepted
  entries. It fills the editor; nothing is saved until the person saves. Same
  rules as every in-app AI feature.

## Context entries

| Field | |
|---|---|
| Kind | **Decision**, **Constraint**, **Convention**, **Vocabulary** |
| Text | Plain text or light Markdown, at most 1,000 characters. One fact per entry |
| Source | The issue it came from, and the PR if there is one (optional for people) |
| Proposed by | A person, or an agent (with its run) |
| Status | Proposed → **Accepted** or **Rejected** |
| Replaces | Optionally, an earlier accepted entry it supersedes |

- **People add directly, in the web app.** A member who adds an entry on the
  Context page adds it accepted.
- **Everything through MCP or an API token is a proposal**, whoever signed in.
  Claude Code and ChatGPT connect *as the person*, so "a person through MCP" is
  usually an AI writing; it waits for review like any agent's entry. It stays
  **Proposed** until a member accepts it, edits and accepts it, or rejects it.
- **Attribution.** A proposal that names an issue claimed by an agent the
  caller runs (its own token, or the person who owns or runs it, e.g. a Claude
  Code routine) is attributed to that agent and its run.
- **Duplicates.** Proposing text that's already accepted or waiting (same kind,
  same words) adds nothing and says so.
- **Replacing.** An entry can name an accepted entry it replaces. When it's
  accepted, the old one shows as "Replaced by …" in Kanso and is no longer
  served to agents. One entry can be replaced at most once (the chain stays
  linear).
- **Where proposals show up.** As a "Context" count on the project's Context
  tab, and in the issue's activity ("Claude proposed a decision: …" with
  Accept / Edit / Reject in place), so the person reviewing the PR sees it at
  the same moment.
- **Archive.** Members can archive any entry; it stops being served, and stays
  in the history.

### When agents propose
`claim_issue` gains one rule:

> Before you finish (open the pull request or release the issue), if this work
> made or relied on a decision, constraint, convention or term that isn't in
> the project context, propose it with `propose_context`, one fact per call,
> citing this issue. Don't repeat what's already there.

A run can have at most **5 pending proposals**; the sixth is refused with
"This run already has 5 proposals waiting for review." This keeps review short.

## Overlap warnings

**What counts as overlap:** two pieces of active work in the same repository
whose changed files intersect. Active work is:

- an **open pull request linked to an issue** (from anyone: agents or people),
  with its changed files;
- an **agent run that has claimed an issue but has no PR yet**, with the files
  it said it plans to change (see below).

**Where the file lists come from:**

| Source | How |
|---|---|
| Open PRs | On `pull_request` `opened`, `reopened` and `synchronize` webhooks, Kanso asks GitHub for the PR's changed files (paths only, through the GitHub App, which already has pull request access) and stores them on the PR link. At most 300 paths; more marks the list as truncated |
| Agent runs before a PR | `report_progress` gets an optional `files` input: "Paths you expect to change." The latest list replaces the earlier one |

**Who is told:**

- **The agent**: `claim_issue` and `report_progress` responses include an
  `overlaps` list ("WEB-41, being worked by Codex, is changing
  `src/auth/session.ts` too (PR acme/web#502)"), plus a rule: *keep your change
  compatible with it; if you can't, ask with `report_progress`
  (`needs_input`)*. Nothing is blocked.
- **People**: an "Overlaps WEB-41" chip on the issue card and in the issue
  panel, listing the shared files, for both issues. It appears and disappears
  as PRs change, merge or close.
- **Not a comment, not a notification.** Overlaps come and go with every push;
  comments would be noise.

Overlap is computed when it's asked for (a query over open PR links and active
runs in the repository), not stored, so it can't go stale.

## MCP changes
All additions are backward compatible (feature 23's contract test must pass
without a breaking-change update):

| Tool | Kind | |
|---|---|---|
| `get_project_context(workspace, project, page?)` | read | The rendered context, as above |
| `propose_context(workspace, project, kind, text, issueKey?, replaces?)` | write | Always a proposal (see "Context entries"). Returns the entry, its status and whether it was a duplicate |
| `claim_issue` | existing | Adds `context` (rendered, within budget), `overlaps`, and the two rules above |
| `report_progress` | existing | New optional `files: string[]` (≤ 300 paths, each ≤ 500 chars); response adds `overlaps` |

Resource: `project://{workspace}/{key}/context`.

## Rules

| | Owner | Admin | Member | Guest | Agent |
|---|:-:|:-:|:-:|:-:|:-:|
| Read the context | ✓ | ✓ | ✓ | shared projects | as owner user |
| Edit the brief, add/accept/reject/archive entries | ✓ | ✓ | ✓ | — | — |
| Propose entries | ✓ | ✓ | ✓ | — | ✓ (proposed only) |
| See overlaps | ✓ | ✓ | ✓ | shared projects | in its own tool responses |

Permission actions: `project.read` to read; a new `context.write` (members
and up) to edit, decide and propose. Agents and token clients hold it through
their role, but the service lets them only propose: editing the brief and
deciding on entries need a person in the web app. API tokens with read scope can read
only. Every change writes an Activity row (`context.brief_updated`,
`context.entry_added`, `context.entry_proposed`, `context.entry_accepted`,
`context.entry_rejected`, `context.entry_archived`).

## Safety
The context goes to **every agent that works in the project**, so it's the most
valuable place to plant a prompt injection.

- **Only accepted content is served.** An agent's proposal, which may carry
  text from an untrusted GitHub issue, reaches no other agent until a member
  accepts it.
- **Accepting shows exactly what will be served**, with the source issue
  marked "imported from GitHub" when it is.
- The rendered context goes out inside the same "data, not instructions"
  framing as other Kanso text, except that it *is* the team's guidance; that's
  why acceptance by a person is the gate.
- File paths from agents are stored as data only: validated as relative paths
  (no `..`, no leading `/`, printable characters), never used to read files.

## Data
```prisma
model ProjectBrief {
  projectId   String   @id
  body        String   @default("")
  version     Int      @default(0)
  updatedById String?
  updatedAt   DateTime @updatedAt
}
model ProjectBriefRevision {
  id        String   @id @default(cuid())
  projectId String
  version   Int
  body      String
  editedById String?
  createdAt DateTime @default(now())
  @@unique([projectId, version])
}
model ContextEntry {
  id                String        @id @default(cuid())
  projectId         String
  kind              ContextKind
  text              String
  status            ContextStatus @default(PROPOSED)
  sourceIssueId     String?
  sourcePrUrl       String?
  proposedByUserId  String?
  proposedByAgentId String?
  runId             String?
  decidedByUserId   String?
  decidedAt         DateTime?
  replacesId        String?                 // the entry this one supersedes; only one accepted replacement per entry (checked on accept)
  archivedAt        DateTime?
  createdAt         DateTime      @default(now())
  @@index([projectId, status, createdAt])
  @@index([runId])
}
enum ContextKind   { DECISION CONSTRAINT CONVENTION VOCABULARY }
enum ContextStatus { PROPOSED ACCEPTED REJECTED }

// Additions
model PullRequestLink { files String[] @default([])  filesTruncated Boolean @default(false) }
model AgentRun        { plannedFiles String[] @default([]) }
```

Service: `lib/services/context.ts` (brief, entries, rendering, overlaps). The
renderer is a pure function, unit-tested on its own.

## UI
- **Project → Context** tab, next to Board / List / Backlog. Brief editor
  (Markdown, preview, History, AI draft), then entries grouped by kind, then
  **Waiting for review** at the top when there are proposals.
- **Issue activity**: proposals from that issue's runs, with Accept / Edit /
  Reject in place.
- **Issue card and panel**: the "Overlaps" chip.
- **Agent setup (feature 13)**: one line noting that agents get the project
  context automatically.

## API (web session)
| Route | |
|---|---|
| `GET /api/projects/[id]/context` | brief, entries (filter by status), counts |
| `PUT /api/projects/[id]/context/brief` | `{ body, version }`; a stale `version` is a 409 ("Someone else saved the brief; reload to see their changes") |
| `GET /api/projects/[id]/context/brief/revisions` · `POST …/revisions/[version]/restore` | history |
| `POST /api/projects/[id]/context/entries` | `{ kind, text, issueId?, replacesId? }` → accepted |
| `PATCH /api/context-entries/[id]` | `{ action: "accept" \| "reject" \| "archive", text? }` (`text` = edit and accept) |
| `POST /api/projects/[id]/context/draft` | AI draft (in-app AI rules) |
| `GET /api/issues/[id]/overlaps` | for the issue panel |
| `GET /api/projects/[id]/overlaps` | every issue's overlaps in one request, for the board's chips |
| `GET /api/issues/[id]/context-proposals` | proposals from the issue, for its panel |

## Out of scope
- Reading Slack, email or meeting transcripts into the context. Kanso holds
  what's decided in Kanso and its PRs; other tools can reach the context over
  MCP.
- Writing the context into the repository (`AGENTS.md` sync). Possible later as
  an export; two sources of truth would drift.
- Workspace-wide context shared across projects. Later, if teams ask: same
  model with a null project.
- Semantic search over entries. The budget plus paging is enough at this size.
- Real-time agent-to-agent messaging. Overlaps tell each agent about the other;
  coordinating goes through people (`needs_input`) or the issue thread.

## Tests (Vitest)
- Rendering: section order, newest first, replaced and archived entries left
  out, budget cut with the right footer, paging.
- Permissions: guests read only on shared projects; members decide; agents
  only propose; the 6th proposal per run is refused; read-scope tokens can't
  propose.
- Replacing: accepting a replacement hides the old entry; an entry can't be
  replaced twice; replacing a non-accepted entry is refused.
- Brief: version conflict is a 409; restore creates a new revision.
- Overlaps: PR/PR, PR/planned files, planned/planned; different repositories
  don't overlap; merged and closed PRs and finished runs drop out; path
  validation rejects `..` and absolute paths.
- Webhook: `synchronize` refreshes a PR's files; more than 300 marks it
  truncated (GitHub faked as in `tests/fake-github.ts`).
- MCP: `claim_issue` includes context and overlaps; the contract test passes
  without a breaking change.

## Acceptance
- A member writes a brief; an agent that claims an issue in the project gets
  it in `claim_issue`, and ChatGPT or Claude gets it from
  `get_project_context`.
- An agent finishing an issue proposes a decision; it shows in the issue's
  activity and on the Context tab as waiting; it is **not** served to another
  agent until a member accepts it; once accepted, the next claim includes it
  with its source.
- A decision that replaces an older one hides the older one from agents and
  shows "Replaced by" in Kanso.
- Two agents (or an agent and a person's PR) change the same file in the same
  repository: both issues show "Overlaps", both agents see it in their next
  tool response, and it disappears when one PR merges.
- The context never exceeds 30,000 characters in any response; the footer
  explains what was left out.
- `pnpm lint`, `tsc --noEmit`, `pnpm test` and `pnpm build` are clean.
