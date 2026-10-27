-- Feature 07: boards become projects, tasks become issues.
-- Hand-written: tables and columns are renamed in place (no data is dropped),
-- then backfilled with project keys, issue numbers, and column categories.

-- CreateEnum
CREATE TYPE "ProjectMode" AS ENUM ('KANBAN', 'SCRUM');
CREATE TYPE "ColumnCategory" AS ENUM ('TODO', 'IN_PROGRESS', 'DONE');
CREATE TYPE "IssueType" AS ENUM ('EPIC', 'STORY', 'TASK', 'BUG', 'SUBTASK');
CREATE TYPE "IssueSource" AS ENUM ('NATIVE', 'GITHUB');
CREATE TYPE "SprintState" AS ENUM ('PLANNED', 'ACTIVE', 'CLOSED');
CREATE TYPE "IssueLinkType" AS ENUM ('BLOCKS', 'RELATES', 'DUPLICATES');

-- ---------- Board → Project ----------
ALTER TABLE "Board" RENAME TO "Project";
ALTER TABLE "Project" RENAME CONSTRAINT "Board_pkey" TO "Project_pkey";
ALTER TABLE "Project" RENAME CONSTRAINT "Board_workspaceId_fkey" TO "Project_workspaceId_fkey";
ALTER INDEX "Board_workspaceId_idx" RENAME TO "Project_workspaceId_idx";
ALTER TABLE "Project"
    ADD COLUMN "key" TEXT,
    ADD COLUMN "issueCounter" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "mode" "ProjectMode" NOT NULL DEFAULT 'KANBAN',
    ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Keys: up to the first three letters of the name, upper-cased ("Web app" → WEB),
-- falling back to PRJ; duplicates within a workspace get 2, 3, … appended.
WITH base AS (
    SELECT
        p."id",
        p."workspaceId",
        coalesce(nullif(upper(left(regexp_replace(p."name", '[^A-Za-z]', '', 'g'), 3)), ''), 'PRJ') AS k,
        p."createdAt"
    FROM "Project" p
    WHERE length(coalesce(nullif(upper(left(regexp_replace(p."name", '[^A-Za-z]', '', 'g'), 3)), ''), 'PRJ')) >= 2
    UNION ALL
    -- One-letter names ("A") are padded so every key is at least two characters.
    SELECT p."id", p."workspaceId", upper(left(regexp_replace(p."name", '[^A-Za-z]', '', 'g'), 1)) || 'P', p."createdAt"
    FROM "Project" p
    WHERE length(coalesce(nullif(upper(left(regexp_replace(p."name", '[^A-Za-z]', '', 'g'), 3)), ''), 'PRJ')) < 2
),
ranked AS (
    SELECT "id", k, row_number() OVER (PARTITION BY "workspaceId", k ORDER BY "createdAt", "id") AS rn
    FROM base
)
UPDATE "Project" p
SET "key" = CASE WHEN r.rn = 1 THEN r.k ELSE r.k || r.rn END
FROM ranked r
WHERE r."id" = p."id";

ALTER TABLE "Project" ALTER COLUMN "key" SET NOT NULL;
CREATE UNIQUE INDEX "Project_workspaceId_key_key" ON "Project"("workspaceId", "key");

-- ---------- Column ----------
ALTER TABLE "Column" RENAME COLUMN "boardId" TO "projectId";
ALTER TABLE "Column" RENAME CONSTRAINT "Column_boardId_fkey" TO "Column_projectId_fkey";
ALTER INDEX "Column_boardId_idx" RENAME TO "Column_projectId_idx";
ALTER TABLE "Column" ADD COLUMN "category" "ColumnCategory" NOT NULL DEFAULT 'IN_PROGRESS';

-- First column = TODO, last column = DONE (when there are two or more), rest IN_PROGRESS.
WITH ordered AS (
    SELECT
        "id",
        row_number() OVER (PARTITION BY "projectId" ORDER BY "position", "createdAt", "id") AS first_rank,
        row_number() OVER (PARTITION BY "projectId" ORDER BY "position" DESC, "createdAt" DESC, "id" DESC) AS last_rank,
        count(*) OVER (PARTITION BY "projectId") AS total
    FROM "Column"
)
UPDATE "Column" c
SET "category" = CASE
    WHEN o.first_rank = 1 THEN 'TODO'::"ColumnCategory"
    WHEN o.last_rank = 1 AND o.total > 1 THEN 'DONE'::"ColumnCategory"
    ELSE 'IN_PROGRESS'::"ColumnCategory"
END
FROM ordered o
WHERE o."id" = c."id";

-- ---------- Label ----------
ALTER TABLE "Label" RENAME COLUMN "boardId" TO "projectId";
ALTER TABLE "Label" RENAME CONSTRAINT "Label_boardId_fkey" TO "Label_projectId_fkey";
ALTER INDEX "Label_boardId_idx" RENAME TO "Label_projectId_idx";

-- ---------- Task → Issue ----------
ALTER TABLE "Task" RENAME TO "Issue";
ALTER TABLE "Issue" RENAME CONSTRAINT "Task_pkey" TO "Issue_pkey";
ALTER TABLE "Issue" RENAME CONSTRAINT "Task_columnId_fkey" TO "Issue_columnId_fkey";
ALTER INDEX "Task_columnId_idx" RENAME TO "Issue_columnId_idx";
ALTER TABLE "Issue"
    ADD COLUMN "projectId" TEXT,
    ADD COLUMN "number" INTEGER,
    ADD COLUMN "type" "IssueType" NOT NULL DEFAULT 'TASK',
    ADD COLUMN "acceptanceCriteria" TEXT,
    ADD COLUMN "estimate" INTEGER,
    ADD COLUMN "parentId" TEXT,
    ADD COLUMN "epicId" TEXT,
    ADD COLUMN "sprintId" TEXT,
    ADD COLUMN "assigneeUserId" TEXT,
    ADD COLUMN "assigneeAgentId" TEXT,
    ADD COLUMN "reporterUserId" TEXT,
    ADD COLUMN "claimedByAgentId" TEXT,
    ADD COLUMN "claimedAt" TIMESTAMP(3),
    ADD COLUMN "source" "IssueSource" NOT NULL DEFAULT 'NATIVE',
    ADD COLUMN "archivedAt" TIMESTAMP(3);

-- Each issue inherits its column's project and is numbered in creation order.
WITH numbered AS (
    SELECT
        i."id",
        c."projectId",
        row_number() OVER (PARTITION BY c."projectId" ORDER BY i."createdAt", i."id") AS n
    FROM "Issue" i
    JOIN "Column" c ON c."id" = i."columnId"
)
UPDATE "Issue" i
SET "projectId" = n."projectId", "number" = n.n
FROM numbered n
WHERE n."id" = i."id";

ALTER TABLE "Issue" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Issue" ALTER COLUMN "number" SET NOT NULL;

UPDATE "Project" p
SET "issueCounter" = coalesce((SELECT max(i."number") FROM "Issue" i WHERE i."projectId" = p."id"), 0);

-- Join table: Prisma orders the implicit columns alphabetically, so the old
-- _TaskLabels (A = Label, B = Task) becomes _IssueLabels (A = Issue, B = Label).
ALTER TABLE "_TaskLabels" RENAME TO "_IssueLabels";
ALTER TABLE "_IssueLabels" DROP CONSTRAINT "_TaskLabels_A_fkey";
ALTER TABLE "_IssueLabels" DROP CONSTRAINT "_TaskLabels_B_fkey";
ALTER TABLE "_IssueLabels" RENAME COLUMN "A" TO "label_tmp";
ALTER TABLE "_IssueLabels" RENAME COLUMN "B" TO "A";
ALTER TABLE "_IssueLabels" RENAME COLUMN "label_tmp" TO "B";
ALTER TABLE "_IssueLabels" DROP CONSTRAINT "_TaskLabels_AB_pkey";
ALTER TABLE "_IssueLabels" ADD CONSTRAINT "_IssueLabels_AB_pkey" PRIMARY KEY ("A", "B");
DROP INDEX "_TaskLabels_B_index";
CREATE INDEX "_IssueLabels_B_index" ON "_IssueLabels"("B");

-- ---------- Activity ----------
ALTER TABLE "Activity" RENAME COLUMN "boardId" TO "projectId";
ALTER TABLE "Activity" RENAME COLUMN "taskId" TO "issueId";
ALTER INDEX "Activity_boardId_createdAt_idx" RENAME TO "Activity_projectId_createdAt_idx";
ALTER INDEX "Activity_taskId_createdAt_idx" RENAME TO "Activity_issueId_createdAt_idx";
UPDATE "Activity" SET "action" = replace(replace("action", 'board.', 'project.'), 'task.', 'issue.');

-- ---------- New tables ----------
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "authorAgentId" TEXT,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Sprint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "state" "SprintState" NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sprint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IssueLink" (
    "id" TEXT NOT NULL,
    "fromIssueId" TEXT NOT NULL,
    "toIssueId" TEXT NOT NULL,
    "type" "IssueLinkType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Issue_parentId_idx" ON "Issue"("parentId");
CREATE INDEX "Issue_epicId_idx" ON "Issue"("epicId");
CREATE INDEX "Issue_assigneeUserId_idx" ON "Issue"("assigneeUserId");
CREATE UNIQUE INDEX "Issue_projectId_number_key" ON "Issue"("projectId", "number");
CREATE INDEX "Comment_issueId_createdAt_idx" ON "Comment"("issueId", "createdAt");
CREATE INDEX "Sprint_projectId_idx" ON "Sprint"("projectId");
CREATE INDEX "IssueLink_toIssueId_idx" ON "IssueLink"("toIssueId");
CREATE UNIQUE INDEX "IssueLink_fromIssueId_toIssueId_type_key" ON "IssueLink"("fromIssueId", "toIssueId", "type");

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_epicId_fkey" FOREIGN KEY ("epicId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_sprintId_fkey" FOREIGN KEY ("sprintId") REFERENCES "Sprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sprint" ADD CONSTRAINT "Sprint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_fromIssueId_fkey" FOREIGN KEY ("fromIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssueLink" ADD CONSTRAINT "IssueLink_toIssueId_fkey" FOREIGN KEY ("toIssueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_IssueLabels" ADD CONSTRAINT "_IssueLabels_A_fkey" FOREIGN KEY ("A") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_IssueLabels" ADD CONSTRAINT "_IssueLabels_B_fkey" FOREIGN KEY ("B") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;
