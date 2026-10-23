#!/bin/bash
# SessionStart hook for Claude Code cloud sessions: brings up a local Postgres,
# writes .env if missing, installs deps, and applies Prisma migrations so
# `pnpm dev`, `pnpm lint`, and `tsc` work immediately.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# ---------- Postgres (the container has no Docker daemon; use the local server) ----------
if ! pg_isready -q -h localhost -p 5432; then
  service postgresql start
  for _ in $(seq 1 20); do
    pg_isready -q -h localhost -p 5432 && break
    sleep 0.5
  done
fi

# Match the credentials in .env.example.
su postgres -c "psql -q -c \"ALTER USER postgres PASSWORD 'postgres';\""
# Dev database, plus a separate one for Vitest (tests truncate tables freely).
for name in task_management task_management_test; do
  if ! su postgres -c "psql -tAc \"SELECT 1 FROM pg_database WHERE datname='$name'\"" | grep -q 1; then
    su postgres -c "createdb $name"
  fi
done

# ---------- .env ----------
if [ ! -f .env ]; then
  cp .env.example .env
  secret="$(openssl rand -base64 32)"
  sed -i "s|replace-with-a-32+-char-random-secret|${secret}|" .env
fi

# ---------- Dependencies (postinstall runs `prisma generate`) ----------
pnpm install

# ---------- Migrations ----------
pnpm prisma migrate deploy
