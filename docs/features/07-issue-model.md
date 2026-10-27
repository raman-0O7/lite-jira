# Feature 07 — Issue model: projects, issue keys, types, subtasks, epics

**Wave 6 · parallel with 08 · depends on 06.** See [`PLAN-v2.md`](../PLAN-v2.md) §4.

## Goal
Turn boards and tasks into Jira-style **projects and issues**: every issue gets a
key (`WEB-42`), a type, an optional parent (sub-issues) or epic, an assignee,
an estimate, acceptance criteria, and comments. Columns get a category so
GitHub sync and agents (11–12) know what "done" means. A small query language
lets the UI, MCP (10), and saved filters (16) search issues the same way.

## Rename (done once, no aliases)
| Phase 1 | Now |
|---------|-----|
| `Board` | `Project` |
| `Task` | `Issue` |
| `boardId` / `taskId` (Column, Label, Activity) | `projectId` / `issueId` |
| `/api/boards/*`, `/api/tasks/*` | `/api/projects/*`, `/api/issues/*` |
| `/[workspace]/boards/[id]` | `/[workspace]/projects/[KEY]` |

The phase 1 UI component files (`BoardView`, `TaskCard`, `TaskModal`, …) keep
their names until Feature 09 rebuilds them; their data and copy use the new model.

## Data model
- `Project { key, issueCounter, mode KANBAN|SCRUM, archivedAt }`, key unique per workspace.
- `Column.category TODO|IN_PROGRESS|DONE`.
- `Issue { projectId, number, type EPIC|STORY|TASK|BUG|SUBTASK, acceptanceCriteria,
  estimate, parentId, epicId, sprintId, assigneeUserId, assigneeAgentId,
  reporterUserId, claimedByAgentId, claimedAt, source NATIVE|GITHUB, archivedAt }`,
  `@@unique([projectId, number])`.
- `Comment { issueId, authorUserId | authorAgentId, body, editedAt }`.
- `Sprint`, `IssueLink` — schema only; UI in 15/16.
- Agent columns (`assigneeAgentId`, `claimedByAgentId`, `authorAgentId`) are plain
  ids until the `Agent` model lands (12).

**Migration** renames tables/columns/constraints in place and backfills:
project keys from the name (unique per workspace), `issueCounter`, issue numbers
in creation order, column categories (first = TODO, last = DONE, rest =
IN_PROGRESS), every existing task as type `TASK`.

## Rules
- **Keys:** 2–10 characters, `A–Z0–9`, starting with a letter; unique per
  workspace; suggested from the project name; immutable after creation.
  Numbers come from `Project.issueCounter` (incremented atomically), so they are
  never reused, even after deletes.
- **Sub-issues:** created with a `parentId` and always type `SUBTASK`. The parent
  must be in the same project and be neither an epic nor a sub-issue (one
  level). Sub-issues land in the project's first `TODO` column. Deleting a
  parent deletes its sub-issues. Type `SUBTASK` can't be set or removed by update.
- **Epics:** `epicId` must point at an `EPIC` in the same project. Epics and
  sub-issues can't belong to an epic. An epic that still has issues can't change
  type. Deleting an epic detaches its issues.
- **Assignee:** a workspace member who is not a guest. Reporter = the creating
  user (for agents: the user they act for).
- **Estimate:** whole points, 0–100. **Acceptance criteria:** Markdown, ≤10k chars.
- **Comments:** members and guests can comment (`comment.write`); only the author
  edits; the author or an admin deletes.
- **New columns** default to `IN_PROGRESS`; the default columns are To Do (TODO),
  In Progress (IN_PROGRESS), Done (DONE).

## Query language (`lib/query`)
Space-separated terms, all ANDed; commas OR values within a term.

| Term | Matches |
|------|---------|
| `assignee:me` / `assignee:none` / `assignee:<email>` | assignee |
| `type:bug,story` | issue type |
| `status:todo` / `in_progress` / `done` | column category |
| `is:open` / `is:done` | not done / done |
| `priority:high,urgent` | priority |
| `label:auth` | label name (case-insensitive) |
| `project:WEB` | project key |
| `epic:WEB-12`, `parent:WEB-40` | epic / parent by key |
| `due:overdue` / `today` / `week` / `none` | due date |
| `WEB-42` | that issue |
| anything else (bare or `"quoted"`) | title or description contains |

Unknown `key:value` terms are a 400 with the offending term, so callers (and
agents) learn the syntax instead of getting silently wrong results.

## API
```
GET|POST  /api/workspaces/[slug]/projects
GET       /api/workspaces/[slug]/issues?q=…          search (max 50)
GET       /api/workspaces/[slug]/issues/[key]        issue by key
GET       /api/workspaces/[slug]/members             assignee picker
GET|PATCH|DELETE /api/projects/[id]                  detail (columns + issues), rename/mode
POST      /api/projects/[id]/columns                 {name, category?}
GET|POST  /api/projects/[id]/labels
PATCH|DELETE /api/columns/[id]                       {name?, category?}
POST      /api/columns/[id]/issues                   {title, type?}
PATCH     /api/columns/reorder                       {projectId, orderedIds}
GET|PATCH|DELETE /api/issues/[id]
PATCH     /api/issues/move
POST      /api/issues/[id]/subissues                 {title}
GET|POST  /api/issues/[id]/comments
PATCH|DELETE /api/comments/[id]
PATCH|DELETE /api/labels/[id]
```

## UI (minimal — the redesign is 09)
- Projects list + create dialog (name, suggested key).
- Board at `/[workspace]/projects/[KEY]`; `/[workspace]/issues/[KEY-N]` opens
  the issue on its board.
- Cards: key, type icon, assignee initials, sub-issue progress.
- Issue modal: key, type, assignee, estimate, epic, acceptance criteria,
  sub-issues (list + add), comments (list + add + delete own).
- Column menu: set category.

## Scope — out
Invites/guest project access (08), redesign (09), MCP (10), GitHub (11),
agents (12), sprint and link UI (15, 16).

## Acceptance criteria
- [x] Migration on a feature 06 database keeps every board/task/label as a
      project/issue/label with keys, numbers, and column categories.
- [x] Issue keys are sequential per project and never reused.
- [x] Sub-issue, epic, assignee, and comment rules above are enforced by services
      (tested).
- [x] Search supports every term above, is scoped to the workspace, and rejects
      unknown terms.
- [x] Every new mutation writes an Activity row.
- [x] Phase 1 behavior (board CRUD, drag-and-drop, filters, labels) still works.
- [x] `pnpm lint`, `tsc --noEmit`, `pnpm test`, `pnpm build` clean.
