# Feature 14 — Loading states

**Depends on 09.**

## Goal
Loading should look like Kanso, not like a bare "Loading…" line. While
something loads, people see the shape of what is coming, so the content
lands where the placeholder was instead of jumping in.

## Building blocks
- `components/ui/skeleton.tsx`: shadcn's Skeleton, a pulsing block in the
  `--track` colour (visible on both the background and cards in both themes).
  The pulse stops under `prefers-reduced-motion`. Blocks are `aria-hidden`.
- `components/ui/spinner.tsx` (existing): the spinning ring, also used by
  `Button`'s `loading` prop.
- `components/loading/skeletons.tsx`:
  - `Loading`: a `role="status"` region that announces one label, such as
    "Loading members", for a whole group of blocks.
  - `InlineLoading`: a spinner and a short label for small spots (menus,
    pickers, selects).
  - Screen skeletons, each matching the real layout's sizes and spacing:

    | skeleton | stands in for |
    |-|-|
    | `AppShellSkeleton` | sidebar and panel while a workspace opens |
    | `ProjectListSkeleton`, `ProjectRowsSkeleton` | the Projects page and its rows |
    | `ProjectSkeleton` | a project: toolbar, filter bar, then board columns of cards, or list groups of rows |
    | `IssueDetailSkeleton`, `IssuePageSkeleton` | an issue (title, description, activity, properties), in the panel or as a page |
    | `ActivitySkeleton` | an issue's timeline |
    | `RowListSkeleton` | Settings lists: members, tokens, connected apps, agents |
    | `CardSkeleton` | GitHub settings |
    | `SettingsSkeleton` | a Settings tab |
    | `SidebarProjectsSkeleton` | the sidebar's project links |
    | `PageSpinner` | sign-in pages and invites |

## Where
- **Route changes** (`loading.tsx`): these show at once on navigation while
  the server renders the next page.

  | route | shows |
  |-|-|
  | `(app)` | `AppShellSkeleton` (opening the app, switching workspace) |
  | `[workspace]/projects` | `ProjectListSkeleton` |
  | `[workspace]/projects/[key]` | `ProjectSkeleton` |
  | `[workspace]/issues/[key]` | `IssuePageSkeleton` |
  | `[workspace]/settings` | `SettingsSkeleton`, under the settings header and tabs |
  | `(auth)` | `PageSpinner` |

- **Client queries**: each "Loading…" line is replaced by the matching
  skeleton:
  - the project list, project and board (list view gets list rows);
  - the issue, its activity, and the issue panel's title;
  - members, API tokens, connected apps, agents and GitHub settings;
  - the sidebar's projects.

  Agent tokens, the label picker and the repository select use
  `InlineLoading`.
- **Actions**:
  - Sign in, Create account and Continue with GitHub use `Button`'s `loading`
    state: a spinner and label swap that doesn't shift the layout.
  - Log out shows a spinner in place of its icon.

## Acceptance criteria
- [x] No screen shows a plain "Loading…" text.
- [x] Skeletons match the layout they replace and work in light and dark.
- [x] Each loading region is announced once to screen readers; the blocks are hidden from them.
- [x] The pulse respects reduced motion.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` clean.
