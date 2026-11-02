# Feature 21 — Sprints

**Depends on 07, 09, 22.**

## Goal
Projects already have a mode (Kanban or Scrum) and a `Sprint` table, both
from 07, but nothing uses them: there's no way to switch a project to Scrum,
plan a sprint, or see how one is going. Teams moving from Jira expect a
backlog, sprint planning, start / complete, a burndown, and velocity.

Kanban projects don't change.

## 1. Modes
- **New project** dialog: *Kanban* (default, continuous flow) or *Scrum*
  (backlog and sprints).
- Project header menu: **Use sprints** / **Stop using sprints**
  (`project.update`). Stopping is refused while a sprint is active
  ("Complete the active sprint first"). Sprints and each issue's sprint are
  kept, so switching back restores them.

## 2. Sprints
`Sprint` gains `number` (per project, for the default name "WEB Sprint 3"),
`startedAt`, `completedAt`, and the totals frozen at start and completion
(`committedIssues`, `committedPoints`, `completedIssues`, `completedPoints`).

| Action | Who | Rules |
|---|---|---|
| Create | `sprint.manage` | Scrum projects only. Planned, name defaults to "KEY Sprint n". |
| Edit name / goal / dates | `sprint.manage` | Not once completed. |
| Delete | `sprint.manage` | Planned only; its issues return to the backlog. |
| Start | `sprint.manage` | One active sprint per project (checked under a row lock on the project). Needs at least one issue. Picks a start date (today) and an end date (1–4 weeks, default 2). Freezes the committed totals. |
| Complete | `sprint.manage` | Active only. Done issues stay in the sprint; open ones move to the next planned sprint, a new sprint, or the backlog. Freezes the completed totals. |

`sprint.manage` is a member (WRITE) action and is never given to agents:
starting and closing a sprint is a team decision. Agents and API tokens can
still put issues into sprints (`issue.write`).

**An issue's sprint** is set with `sprintId` on the issue update (and on
create). The sprint must be in the issue's project and not completed. Epics
don't go in sprints; sub-issues follow their parent (moving a parent moves
its sub-issues). The change is recorded as `changes.sprintId` in the issue's
history. Completing a sprint records the move for each issue it moves.

Activity: `sprint.created`, `sprint.started`, `sprint.completed`,
`sprint.deleted` (project-level, no issue).

## 3. Backlog (Scrum projects)
Scrum projects get four views: **Backlog · Board · List · Reports**
(`?view=backlog|list|reports`, board is the default).

Backlog shows, top to bottom:
1. **Active sprint**: name, dates, days left, goal, done / total (points when
   estimated), and **Complete sprint**.
2. **Planned sprints**, in creation order: name, goal, issue count and points,
   **Start sprint** (when nothing is active), edit, delete.
3. **Backlog**: open issues in no sprint, and **Create sprint**.

Each section lists its issues as compact rows (priority, key, status, type,
title, estimate, assignee), highest priority first then oldest. Epics and
sub-issues aren't rows of their own (sub-issues travel with their parent). A row's **Move to** menu sends the issue to any open sprint or to the
backlog; the issue panel gets a **Sprint** property with the same choices.
"Add issue" in a section creates the issue in that sprint.

**Board and List** in a Scrum project show the active sprint's issues only,
with a sprint strip above them (name, dates, days left, progress, Complete
sprint). With no active sprint they show an empty state that links to the
backlog. New issues from the board go into the active sprint.

## 4. Reports
- **Burndown** for the active sprint, or a completed one picked from a menu:
  remaining work per day from start to end, with the ideal line from the
  committed total to zero. The unit is story points when any issue in the
  sprint has an estimate, otherwise issues.

  It's rebuilt from issue history, so it needs no daily job. Starting from
  each issue's current state, replay its history backwards (moves, estimate
  changes, sprint changes) to get its column, estimate and sprint at the end
  of each day. An issue counts as remaining on a day if it's in the sprint
  and its column isn't *done*. Every column change goes through `moveIssue`,
  which records the move. Completing a sprint marks the moves that take its
  open issues out (`sprintCompleted`), and the replay counts them as after
  the end, so a completed sprint's last day shows the work left when it ended.
- **Velocity**: the last seven completed sprints, committed vs completed,
  in points if any of them were estimated, otherwise in issues; plus the
  average completed.

## 5. Query language and MCP
- `sprint:active`, `sprint:none` (backlog), `sprint:"WEB Sprint 3"`.
- `create_issue` and `update_issue` take `sprint`: a sprint name, `"active"`,
  or `null` for the backlog.
- `get_project` lists the active and planned sprints.
- The `plan_sprint` prompt uses these to suggest a sprint and put issues in it
  on request. Starting and completing stay in the app.

## Acceptance
- [x] Mode is chosen at creation and switched from the project header; stopping is refused while a sprint is active.
- [x] Create, edit, delete, start, complete; one active sprint per project; open issues move on completion as chosen.
- [x] Backlog view with sprint sections and Move to; Sprint property on the issue panel; sub-issues follow their parent.
- [x] Board and List show the active sprint with the sprint strip; empty state with no active sprint.
- [x] Burndown rebuilt from history; velocity for completed sprints.
- [x] `sprint:` in queries; `sprint` on `create_issue` / `update_issue`; sprints in `get_project`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean; browser smoke.
