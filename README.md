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
   both are set).

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

   Visit http://localhost:3000. Hitting `/boards` while logged out redirects to
   `/login` (the login UI ships in Feature 01).

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
  (app)/boards/page.tsx        # protected placeholder (prints session email)
  api/auth/[...all]/route.ts   # Better Auth handler
  layout.tsx  globals.css
lib/
  auth.ts        # Better Auth server instance + getSession() / requireUser()
  auth-client.ts # Better Auth React client
  db.ts          # Prisma singleton
  validations/   # Zod schemas (shared contracts: board, column, task, label)
components/ui/   # shadcn primitives
prisma/
  schema.prisma  # data model (single source of truth)
docker-compose.yml
```
