# Feature 00 — Foundation

**Wave 1 · runs ALONE before all others · blocking.**

Creates the project, infrastructure, data model, auth core, and the shared
contracts every other feature imports. No product UI yet beyond a placeholder.

## Goal

A booting Next.js app with: Tailwind + shadcn, Postgres in Docker, Prisma schema
migrated, Better Auth wired (server + client), and `lib/` contracts published.

## Depends on
Nothing.

## Scope — in
- Scaffold Next.js (App Router, TS, ESLint) with **pnpm**.
- Tailwind CSS + shadcn/ui init (add: button, input, dialog, dropdown-menu,
  select, badge, card, sonner, label, textarea, popover, calendar).
- `docker-compose.yml` for Postgres 16 + `.env.example`.
- Prisma init, full `schema.prisma` (below), first migration, `lib/db.ts` singleton.
- Better Auth server (`lib/auth.ts`) + client (`lib/auth-client.ts`) +
  `app/api/auth/[...all]/route.ts`. Enable emailAndPassword + GitHub provider.
- Auth helpers `getSession()` and `requireUser()`.
- Zod validation skeleton in `lib/validations/` (board, column, task, label).
- Root layout with `<Toaster/>`, font, global styles.
- Placeholder protected page `/boards` that prints session email (proves auth).
- README with setup steps; `.gitignore`; `git init` + initial commit.

## Scope — out
Real auth pages (F01), board/task UI (F02+). Keep placeholder minimal.

## Files (owns)
```
package.json, pnpm-lock.yaml, tsconfig.json, next.config.*, tailwind config,
components.json, docker-compose.yml, .env.example, .gitignore, README.md
prisma/schema.prisma
lib/db.ts  lib/auth.ts  lib/auth-client.ts
lib/validations/{board,column,task,label}.ts
app/layout.tsx  app/globals.css
app/api/auth/[...all]/route.ts
app/(app)/boards/page.tsx   # placeholder
components/ui/*              # shadcn generated
```

## Prisma schema (authoritative)

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "postgresql"; url = env("DATABASE_URL") }

// ---------- Better Auth ----------
model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]
  boards        Board[]
}
model Session {
  id        String   @id
  token     String   @unique
  expiresAt DateTime
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}
model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}

// ---------- App ----------
model Board {
  id        String   @id @default(cuid())
  name      String
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  columns   Column[]
  labels    Label[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
model Column {
  id        String   @id @default(cuid())
  name      String
  position  Int
  boardId   String
  board     Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  tasks     Task[]
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  @@index([boardId])
}
model Task {
  id          String    @id @default(cuid())
  title       String
  description String?
  priority    Priority  @default(MEDIUM)
  dueDate     DateTime?
  position    Int
  columnId    String
  column      Column    @relation(fields: [columnId], references: [id], onDelete: Cascade)
  labels      Label[]   @relation("TaskLabels")
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@index([columnId])
}
model Label {
  id        String   @id @default(cuid())
  name      String
  color     String
  boardId   String
  board     Board    @relation(fields: [boardId], references: [id], onDelete: Cascade)
  tasks     Task[]   @relation("TaskLabels")
  createdAt DateTime @default(now())
  @@index([boardId])
}
enum Priority { LOW MEDIUM HIGH URGENT }
```

## API map (published for all features)

| Method | Path | Feature | Purpose |
|--------|------|---------|---------|
| * | `/api/auth/[...all]` | 00 | Better Auth handler |
| GET/POST | `/api/boards` | 02 | list / create boards |
| GET/PATCH/DELETE | `/api/boards/[id]` | 02 | board read/rename/delete |
| POST | `/api/boards/[id]/columns` | 02 | add column |
| PATCH/DELETE | `/api/columns/[id]` | 02 | rename / delete column |
| PATCH | `/api/columns/reorder` | 02 | reorder columns `{boardId, orderedIds[]}` |
| POST | `/api/columns/[id]/tasks` | 03 | create task in column |
| GET/PATCH/DELETE | `/api/tasks/[id]` | 03/04 | task read/update/delete |
| PATCH | `/api/tasks/move` | 03 | `{taskId, toColumnId, toPosition}` |
| GET/POST | `/api/boards/[id]/labels` | 04 | list / create labels |
| PATCH/DELETE | `/api/labels/[id]` | 04 | edit / delete label |

## Better Auth notes
- `lib/auth.ts`: `betterAuth({ database: prismaAdapter(db,{provider:"postgresql"}),
  emailAndPassword:{enabled:true}, socialProviders:{ github:{clientId,clientSecret} } })`.
- GitHub creds from `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (placeholders ok in
  `.env.example`; app must still boot without them — guard social provider if unset).
- `requireUser()` → redirect to `/login` when no session (server-side).

## Acceptance criteria
- [ ] `docker compose up -d` starts Postgres; `pnpm prisma migrate dev` succeeds.
- [ ] `pnpm dev` boots; visiting `/boards` while logged out redirects to `/login`
      (login page can be a stub from F01, or temporary placeholder here).
- [ ] Better Auth tables exist; `/api/auth` responds.
- [ ] `pnpm build` + `pnpm lint` clean.
- [ ] `.env.example`, README setup steps, initial git commit present.
