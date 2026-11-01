# Feature 22 — My Work, saved filters, issue links

**Depends on 07, 09, 17.**

## Goal
Work now spreads across projects, and agents work issues for people. Three
gaps:
- there's no single place for "what's on my plate", including what my agents
  are waiting on me for;
- the query language (`assignee:me is:open label:auth`) only lives in ⌘K and
  MCP: there's no page of results and no way to keep a query;
- `IssueLink` has existed since 07 with no UI, so "blocked by" can't be said.

## 1. My Work — `/[workspace]/my-work`
Sidebar: **My work** above Projects. `G M` and ⌘K "Go to my work".

**Assigned to me** (default tab), in sections, each sorted most urgent first
(overdue, then priority, then due date, then last updated):
| Section | Issues |
|---|---|
| **Needs you** | Your agent's run is waiting for input (you own the agent and nobody else claimed it, or you're the run's runner, see 17 "Claim codes"); or a pull request is open on an issue assigned to you (review it) |
| **In progress** | assigned to you, column category In progress |
| **To do** | assigned to you, category To do |
| **Done this week** | assigned to you, done, updated in the last 7 days (collapsed) |

An issue appears once, in the first section it qualifies for. "Assigned to
you" includes issues your agent works for you (the person stays the assignee).

**Created by me**: open issues you reported, assigned to anyone.

Rows: type icon, key, title, project, labels, due date, status, priority,
person + agent avatars, run badge, and a **Blocked** chip when an open issue
blocks it. Clicking a row opens the issue page. `J`/`K`/`Enter` as in the list
view. Empty sections are hidden; an empty tab says so and links to Projects.

Server: `getMyWork(ctx)` → `{ needsYou, inProgress, todo, doneThisWeek,
created }`, each a list of cross-project cards (`toCard` + project), capped at
100 per section. Scoped by `projectScope` like everything else (guests see
only shared projects).

## 2. Issues page and saved filters
**`/[workspace]/issues?q=…`** — a query box (the query language, with a
syntax cheat sheet), and the matching issues as the same rows, newest activity
first, up to 100. Errors from the parser show under the box (e.g. `Unknown
value "urgnt" for priority:`). The query is kept in the URL so it can be
shared. `G I` and ⌘K "Search issues" open it (⌘K carries what's typed).

**Saved filters**
- `SavedFilter { id, workspaceId, ownerUserId, name, query, shared, createdAt,
  updatedAt }`, unique `(workspaceId, ownerUserId, name)`.
- **Save filter** on the issues page: a name, and **Share with the workspace**.
  The query must parse.
- Sidebar section **Filters**: yours, then shared ones from teammates (with
  their name). Each opens `/[workspace]/issues?filter=<id>`, which loads its
  query; editing the query and pressing **Save** updates it (yours only);
  **Save as new** forks it.
- Results always run as the viewer: a shared filter never shows issues from
  projects the viewer can't see.
- Permissions: anyone in the workspace saves personal filters (guests too);
  sharing needs `issue.write` (members and up); the owner edits and deletes;
  admins may delete shared ones (`filter.moderate`, admin). Tokens/agents
  can read filters but not create them.
- API: `GET/POST /api/workspaces/[slug]/filters`, `PATCH/DELETE
  /api/workspaces/[slug]/filters/[id]`.
- MCP: `list_saved_filters` → `{ name, query, shared, owner }`; run one with
  `search_issues`.

## 3. Issue links
Types, shown from each side:
| Stored | On the "from" issue | On the "to" issue |
|---|---|---|
| `BLOCKS` | blocks | is blocked by |
| `RELATES` | relates to | relates to |
| `DUPLICATES` | duplicates | is duplicated by |

- **Issue page, "Links" section** under Sub-issues: grouped by how it reads
  from this issue, each with key, title, status; **Link issue** opens a picker
  (relation + issue search by key or text); a row's × removes the link.
- Rules: both issues in the workspace and visible to the caller; not itself;
  no duplicate (RELATES counts both directions); `issue.write` to add or
  remove. Activity `issue.linked` / `issue.unlinked` on both issues ("linked
  WEB-3: blocks").
- **Blocked**: an issue is blocked while any issue that blocks it isn't done.
  Cards, list rows and My Work rows show a **Blocked** chip (tooltip names the
  blockers). Query language: `is:blocked`.
- `getIssue` returns `links: { id, relation, issue: { id, key, title,
  status: { name, category } } }[]`; cards return `blockedBy: string[]` (open
  blocker keys).
- MCP: `get_issue` includes links; `link_issues { key, relation, target,
  remove? }`. `claim_issue` rules mention open blockers.

## Acceptance criteria
- [x] My Work shows Needs you / In progress / To do / Done this week and Created by me, scoped to what the caller can see; sidebar, `G M`, ⌘K.
- [x] Issues page runs the query language from the URL; parse errors show inline.
- [x] Saved filters: personal and shared, owner edits, admins delete shared, sidebar lists them, results run as the viewer.
- [x] Links: add/remove from the issue page with both directions shown; Blocked chip on cards, rows and My Work; `is:blocked`; activity on both issues.
- [x] MCP: `list_saved_filters`, `link_issues`, links in `get_issue`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean; browser smoke.
