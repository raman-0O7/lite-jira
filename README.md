# Kanso

Issue tracking for teams and solo freelancers, built to work with AI agents:
workspaces with roles, projects with issue keys (`WEB-42`), issue types,
sub-issues, epics, comments, and a Kanban board. Phase 1 is described in
[`docs/PLAN.md`](docs/PLAN.md); the current roadmap is
[`docs/PLAN-v2.md`](docs/PLAN-v2.md).

## Stack

- **Next.js 16** (App Router) + **TypeScript** + **React 19**
- **Postgres 16** via local **docker-compose**
- **Prisma 6** ORM (`prisma-client-js` generator)
- **Better Auth** (email/password + GitHub OAuth, Prisma adapter)
- **Tailwind CSS v4** + **shadcn/ui**
- **Zod** for validation, **TanStack Query** for client data fetching

## Prerequisites

- Node 20+ (developed on Node 22)
- [pnpm](https://pnpm.io) 10+
- Docker (for Postgres)

## Setup

1. **Install dependencies**

   ```bash
   pnpm install
   ```

2. **Configure environment**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and set a real `BETTER_AUTH_SECRET` (e.g. `openssl rand -base64 32`).
   GitHub OAuth is optional — leave `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
   empty and the app still boots (the GitHub provider is only registered when
   both are set). The "Continue with GitHub" button always renders, but it only
   completes the OAuth flow once both credentials are set; without them it shows
   a "GitHub sign-in is unavailable" toast. Email/password sign-up and login work
   with no GitHub credentials at all.
   Invite emails are optional too: set `RESEND_API_KEY` and `EMAIL_FROM` to send
   them through [Resend](https://resend.com). Without them, the inviter gets a
   link to share and the server logs the email instead.

3. **Start Postgres**

   ```bash
   docker compose up -d
   ```

4. **Run the database migration** (also generates the Prisma client)

   ```bash
   pnpm prisma migrate dev
   ```

5. **Start the dev server**

   ```bash
   pnpm dev
   ```

   Visit http://localhost:3000. Sign up at `/signup`: every account gets a
   personal workspace and lands on `/{workspace}/boards`. Hitting a protected page
   while logged out redirects to `/login`; visiting `/login` or `/signup` while
   logged in redirects to your workspace. Route protection is enforced
   server-side in `app/(app)/layout.tsx` via `requireUser()`.

## Common commands

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm lint` | Lint with ESLint |
| `pnpm typecheck` | Generate Next route types, then `tsc --noEmit` |
| `pnpm test` | Run Vitest against the `task_management_test` database (override with `TEST_DATABASE_URL`; the name must end in `_test`) |
| `pnpm prisma migrate dev` | Apply migrations + regenerate client |
| `pnpm prisma studio` | Browse the database |
| `docker compose up -d` | Start Postgres |
| `docker compose down` | Stop Postgres (data persists in a volume) |

## Project layout

```
app/
  page.tsx                          # / → projects when signed in, else /login
  (auth)/login, signup              # public auth pages (?next= returns after sign-in)
  (auth)/invite/[token]             # accept a workspace invite
  (app)/[workspace]/projects        # projects list (workspace-scoped)
  (app)/[workspace]/projects/[key]  # project board (Kanban), ?issue=KEY opens an issue
  (app)/[workspace]/issues/[key]    # issue as a full page (WEB-42)
  (app)/[workspace]/settings        # members, invites, guest access; rename/leave/delete; integrations; agents; API & MCP
  (auth)/oauth/consent              # OAuth consent for MCP clients
  (app)/projects, boards            # post-login landing + legacy redirects
  api/                              # thin route handlers over lib/services
  api/mcp                           # remote MCP server (OAuth or `kanso_` API token)
  api/github/webhooks, callback     # GitHub App webhooks and install/link redirect
  api/cron/agent-watchdog           # fails agent runs nobody claimed (Bearer CRON_SECRET)
  .well-known/                      # OAuth discovery, forwarded to Better Auth
lib/
  services/      # all business logic: authorize → validate → write + Activity
  query/         # issue query language (assignee:me type:bug …)
  mcp/           # MCP tools, resources, prompts; name resolution; rate limit
  github/        # GitHub App client, webhook handlers, status sync
  agents/        # agent dispatcher, Claude Code routine + webhook adapters, run lifecycle
  api/           # client fetchers + route ctx/handler helpers
  permissions.ts # role matrix + agent cap
  validations/   # Zod schemas
  auth.ts, db.ts
components/
  board/         # board, cards, issue modal (rebuilt in Feature 09)
  workspace/     # workspace switcher, settings pages, invite actions
  ui/            # shadcn primitives
prisma/schema.prisma
tests/           # Vitest (services, permissions, query language)
```

See [`docs/PLAN-v2.md`](docs/PLAN-v2.md) for the phase 2 roadmap and
`docs/features/` for each feature's spec.

## Auth notes

- **Route protection** is server-side in `app/(app)/layout.tsx` (`requireUser()`),
  not middleware. Better Auth validates the session against the database, which
  is reliable in a Server Component but not in Next's middleware runtime.
- **MCP server** at `/api/mcp`: clients sign in with OAuth 2.1 (Better Auth
  `mcp()` + CIMD, with dynamic registration as a fallback) or send a personal
  API token (`Authorization: Bearer kanso_…`, created in Settings → API & MCP).
  Both act as the user, capped by the credential. See
  [`docs/features/10-mcp-server.md`](docs/features/10-mcp-server.md).
- **GitHub App** (optional): install from Settings → Integrations to import
  assigned issues, sync status both ways, and link PRs with checks. With no app
  yet, admins create one there in a few clicks and paste the env values it
  shows into the host. Setup: [`docs/github-app.md`](docs/github-app.md); specs:
  [`docs/features/11-github-app.md`](docs/features/11-github-app.md),
  [`docs/features/15-github-setup.md`](docs/features/15-github-setup.md).
- **Agents**: Settings → Agents adds Claude Code routines (fired with the
  routine's own trigger token; Kanso never handles Claude.ai credentials) or
  self-hosted MCP agents (agent tokens, optional signed webhook). Assigning an
  issue to an agent dispatches a run naming the issue's repository (Claude Code
  needs the project to have one); the agent claims it over MCP, opens a PR,
  and a person merges. Agent secrets are encrypted with `ENCRYPTION_KEY`. Point
  a scheduler at `GET /api/cron/agent-watchdog` with `CRON_SECRET` to fail runs
  nobody claimed within `AGENT_CLAIM_TIMEOUT_MINUTES` (it also runs whenever
  runs are read). Spec: [`docs/features/12-agents.md`](docs/features/12-agents.md).
- **Guided setup**: the Projects page's Get started card, the assignee menu's
  "Invite people…" / "Add an AI agent…" rows, and a step-by-step agent setup
  dialog that detects when Kanso is connected to Claude. Spec:
  [`docs/features/13-guided-setup.md`](docs/features/13-guided-setup.md).
- **Loading states**: skeletons shaped like each screen (routes and queries),
  and spinners in buttons, menus and pickers. Spec:
  [`docs/features/14-loading-states.md`](docs/features/14-loading-states.md).
- **Out of scope** (future work): password reset, email verification, profile
  editing.
