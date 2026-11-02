-- DropIndex
DROP INDEX "Sprint_projectId_idx";

-- AlterTable
ALTER TABLE "Sprint" ADD COLUMN     "committedIssues" INTEGER,
ADD COLUMN     "committedPoints" INTEGER,
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "completedIssues" INTEGER,
ADD COLUMN     "completedPoints" INTEGER,
ADD COLUMN     "number" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Sprint_projectId_state_idx" ON "Sprint"("projectId", "state");

