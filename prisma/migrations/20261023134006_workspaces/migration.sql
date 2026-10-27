-- Feature 06: move board ownership from users to workspaces.
-- Hand-edited so existing data survives: every user gets a personal workspace
-- (OWNER membership) and their boards move into it before Board.userId is dropped.

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'GUEST');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AGENT', 'GITHUB', 'SYSTEM');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "personal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "boardId" TEXT,
    "taskId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorAgentId" TEXT,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_createdAt_idx" ON "Activity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_boardId_createdAt_idx" ON "Activity"("boardId", "createdAt");

-- CreateIndex
CREATE INDEX "Activity_taskId_createdAt_idx" ON "Activity"("taskId", "createdAt");


-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one personal workspace per existing user. Ids are derived from the
-- user id so boards can be joined back below; slugs get a short hash suffix so
-- users with the same name never collide.
INSERT INTO "Workspace" ("id", "name", "slug", "personal", "createdAt", "updatedAt")
SELECT
    'ws' || substr(md5(u."id" || ':personal-workspace'), 1, 23),
    coalesce(nullif(trim(u."name"), ''), 'Personal'),
    left(
      coalesce(nullif(trim(both '-' from regexp_replace(lower(u."name"), '[^a-z0-9]+', '-', 'g')), ''), 'workspace'),
      40
    ) || '-' || substr(md5(u."id"), 1, 6),
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User" u;

INSERT INTO "Membership" ("id", "workspaceId", "userId", "role", "createdAt", "updatedAt")
SELECT
    'mb' || substr(md5(u."id" || ':personal-membership'), 1, 23),
    'ws' || substr(md5(u."id" || ':personal-workspace'), 1, 23),
    u."id",
    'OWNER',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "User" u;

-- Move boards into their owner's personal workspace, then drop Board.userId.
ALTER TABLE "Board" ADD COLUMN "workspaceId" TEXT;

UPDATE "Board" b
SET "workspaceId" = 'ws' || substr(md5(b."userId" || ':personal-workspace'), 1, 23);

ALTER TABLE "Board" ALTER COLUMN "workspaceId" SET NOT NULL;

ALTER TABLE "Board" DROP CONSTRAINT "Board_userId_fkey";

ALTER TABLE "Board" DROP COLUMN "userId";

-- CreateIndex
CREATE INDEX "Board_workspaceId_idx" ON "Board"("workspaceId");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
