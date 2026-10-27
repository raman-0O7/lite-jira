# Feature 09 — Design system & redesign

**Wave 7 · depends on 07, 08.** See [`PLAN-v2.md`](../PLAN-v2.md) §6 "09 — Redesign".

## Goal
Give Kanso its own look: the agreed "A · Precision" direction (Linear-like, dense,
dark-first, both themes), a sidebar app shell, a board and a list view, an issue
panel and page with an activity timeline, a ⌘K command palette, and keyboard
shortcuts. Every phase 1 screen is reworked onto the new tokens.

## Design tokens (`app/globals.css`)
- **Type:** Inter Tight for headings (24 / 19 / 15, weight 600, tight tracking),
  Inter for UI (13 body, 12 meta), JetBrains Mono for issue keys and numbers (11).
  Loaded with `next/font/google` as `--font-inter`, `--font-inter-tight`,
  `--font-jetbrains-mono`. Fixes the old `--font-sans: var(--font-sans)`
  self-reference that rendered the app in Times New Roman.
- **Color (dark / light):** chrome `#08090A` / `#F1F1F3` (page background and
  sidebar), panel `#0F1012` / `#FFFFFF`, surface `#17181C` / `#FFFFFF`, field
  `#141518` / `#F6F6F8`, chip `#202227` / `#F0F0F3`, border `#222429` / `#E4E5E9`,
  text `#EEEFF1` / `#15161A`, soft text `#C6C8CE` / `#3B3D44`, muted
  `#8B8E96` / `#61646C`, accent `#5E62E8` / `#5357DD`, accent text
  `#A9ACFF` / `#4045C2`, and status colors green, amber, violet, blue, red,
  orange. shadcn variables map onto these, so existing primitives restyle
  themselves: `primary` is the indigo accent; `accent` stays shadcn's hover
  surface.
- **Shape:** radius 5 controls · 8 cards · 10 panels; 4px spacing grid; panel
  and card shadows per theme.
- **Theme:** dark by default. The user menu offers Dark / Light / System and the
  toolbar has a quick toggle. The choice is stored in `localStorage`; an inline
  script in the root layout applies it before first paint (no flash).

## Iconography
Lucide at 13–15px, stroke 2, plus custom icons in `components/icons/`:
- **Status** by column category: to do = dashed circle, in progress = half
  circle (later in-progress columns = three-quarter), done = filled check.
- **Priority:** three bars filled by level; urgent = orange tile with "!".
- **Issue type:** epic (violet zap), story (green bookmark), task (blue check),
  bug (red), sub-issue (gray corner arrow).
- **Avatars:** initials on a color derived from the person's id (image when
  present). **Project tiles:** a letter on a color derived from the key.

## App shell
- Page background is the chrome color. A 240px **sidebar** on the left:
  workspace switcher (ensō mark), "Search or jump to… ⌘K", nav (Projects,
  Settings), the workspace's projects (colored tiles, active state, "+" for
  those who can create), and the user row (theme, log out) at the bottom.
- The page content sits in an **inset panel** (1px border, radius 10, panel
  shadow) with a 48px toolbar per page.
- Below `md` the sidebar becomes a drawer opened from the toolbar.

## Project views
- Toolbar: project tile and name, view title, **Board | List** switch
  (`?view=list`), members on the project, theme toggle, **New issue** (`C`).
- Filter row (40px): search, Priority / Labels / Due filters as compact chips,
  active filter count + clear, and done-progress (`12 / 30 done`) on the right.
- **Board:** columns without boxes; 28px header (status icon, name, count, add,
  menu). Cards: type icon + mono key + priority icon, title, meta row (label
  pills with color dot, sub-issue progress, estimate, due date, assignee).
  Drag and drop, column reorder, and guest read-only behaviour are unchanged.
- **List:** issues grouped by column (status icon, name, count); 36px rows with
  priority, key, status, title, labels, due date, assignee. `J`/`K` move the
  selection, `Enter` opens it.
- **New issue dialog:** title, type, status (column), priority, assignee. The
  create API gains optional `priority`, `assigneeUserId`, `description`.

## Issue panel & page
- Clicking a card or row opens a **side panel** over the view (`?issue=WEB-42`,
  shareable); `Esc` closes it, and it has an "Open as page" link.
- `/[workspace]/issues/[key]` is now a **full page** (it used to redirect to the
  board): breadcrumb toolbar with "Copy link", the content column, and a
  properties rail.
- Both share one component: type/epic line, large editable title, description
  (Markdown, click to edit), acceptance criteria, sub-issues with progress bar,
  and the **activity timeline**. Properties: status, priority, assignee, type,
  labels, estimate, due date, epic, reporter, created/updated.
- Status changes from the panel move the issue to the end of the chosen column.

## Activity timeline
- `GET /api/issues/[id]/activity` → the issue's activity, oldest first, with the
  names it refers to (people, columns, labels) resolved server-side. Same
  visibility as the issue (guests: shared projects only; otherwise 404).
- The timeline merges activity rows (created, field changes, moves) with
  comments by time; comment activity rows are skipped (the comment itself
  shows). The comment composer sits at the bottom.

## Command palette & shortcuts
- **⌘K / Ctrl K** opens the palette: issue search (key or text, via the existing
  search API), projects, navigation (projects, members, general settings),
  actions (new issue on a project page, new project, theme, switch workspace).
- Shortcuts (ignored while typing in a field): `C` new issue, `/` filter,
  `G P` projects, `G S` settings, `G B` / `G L` board / list, `?` shortcut help,
  `Esc` close panel. `?` lists them all.

## Other screens
Projects page (project rows with tiles and counts), settings (members, general),
auth pages (login, signup, invite), and the landing page move onto the new
tokens and shell.

## Code layout
Phase 1 names go: `components/board/*` splits into `components/project/`
(ProjectList, ProjectCard, ProjectView, board, list, filters) and
`components/issue/` (IssueDetail, IssuePanel, properties, activity, sub-issues,
pickers); icons live in `components/icons/`; the shell in `components/app-shell/`.

## Scope — out
My Work, Inbox, agent runs, sprints (15, 16, 12), live agent states and PR
checks on cards (11, 12) — the card and panel leave room for them.

## Acceptance criteria
- [x] Inter / Inter Tight / JetBrains Mono render (no Times New Roman).
- [x] Dark is the default; light and system work without a flash on reload.
- [x] Sidebar shell on every workspace page; drawer on small screens.
- [x] Board and list views over the same filters; drag and drop still works.
- [x] Issue panel and full issue page with an activity timeline and comments.
- [x] ⌘K palette finds issues by key and text and navigates; shortcuts work.
- [x] Guests still get read-only views.
- [x] Activity service is tested, including guest visibility.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
