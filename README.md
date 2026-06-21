# Lite Jira — Task Management

A solo, self-hosted Kanban task manager: multiple boards, customizable columns,
drag-and-drop tasks, and auth. See [`docs/PLAN.md`](docs/PLAN.md) for the full
architecture and feature roadmap.

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

   Visit http://localhost:3000. Sign up at `/signup`, then you land on `/boards`.
   Hitting `/boards` while logged out redirects to `/login`; visiting `/login` or
   `/signup` while logged in redirects to `/boards`. Route protection is enforced
   server-side in `app/(app)/layout.tsx` via `requireUser()`.

## Common commands

| Command | What it does |
|---------|--------------|
| `pnpm dev` | Start the Next.js dev server |
| `pnpm build` | Production build |
| `pnpm lint` | Lint with ESLint |
| `pnpm prisma migrate dev` | Apply migrations + regenerate client |
| `pnpm prisma studio` | Browse the database |
| `docker compose up -d` | Start Postgres |
| `docker compose down` | Stop Postgres (data persists in a volume) |

## Project layout

```
app/
  (auth)/login/page.tsx        # public — email/password + GitHub sign-in
  (auth)/signup/page.tsx       # public — create account, then sign in
  (auth)/layout.tsx            # centered card layout for auth pages
  (app)/layout.tsx             # protected app shell + auth guard (requireUser)
  (app)/boards/page.tsx        # protected placeholder (prints session email)
  api/auth/[...all]/route.ts   # Better Auth handler
  layout.tsx  globals.css
lib/
  auth.ts        # Better Auth server instance + getSession() / requireUser()
  auth-client.ts # Better Auth React client
  db.ts          # Prisma singleton
  validations/   # Zod schemas (auth, board, column, task, label)
components/
  ui/            # shadcn primitives
  auth/          # login/signup forms, GitHub button, auth card
  app-shell/     # top bar + user menu (logout)
prisma/
  schema.prisma  # data model (single source of truth)
docker-compose.yml
```

## Auth notes

- **Route protection** is server-side in `app/(app)/layout.tsx` (`requireUser()`),
  not middleware. Better Auth validates the session against the database, which
  is reliable in a Server Component but not in Next's middleware runtime.
- **Out of scope** (future work): password reset, email verification, profile
  editing.
