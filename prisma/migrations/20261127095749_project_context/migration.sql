-- CreateEnum
CREATE TYPE "ContextKind" AS ENUM ('DECISION', 'CONSTRAINT', 'CONVENTION', 'VOCABULARY');

-- CreateEnum
CREATE TYPE "ContextStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "plannedFiles" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PullRequestLink" ADD COLUMN     "files" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "filesTruncated" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProjectBrief" (
    "projectId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectBrief_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "ProjectBriefRevision" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "editedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectBriefRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContextEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ContextKind" NOT NULL,
    "text" TEXT NOT NULL,
    "status" "ContextStatus" NOT NULL DEFAULT 'PROPOSED',
    "sourceIssueId" TEXT,
    "sourcePrUrl" TEXT,
    "proposedByUserId" TEXT,
    "proposedByAgentId" TEXT,
    "runId" TEXT,
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "replacesId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContextEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectBriefRevision_projectId_version_key" ON "ProjectBriefRevision"("projectId", "version");

-- CreateIndex
CREATE INDEX "ContextEntry_projectId_status_createdAt_idx" ON "ContextEntry"("projectId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ContextEntry_runId_idx" ON "ContextEntry"("runId");

-- CreateIndex
CREATE INDEX "ContextEntry_sourceIssueId_idx" ON "ContextEntry"("sourceIssueId");

-- CreateIndex
CREATE INDEX "ContextEntry_replacesId_idx" ON "ContextEntry"("replacesId");

-- AddForeignKey
ALTER TABLE "ProjectBrief" ADD CONSTRAINT "ProjectBrief_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBriefRevision" ADD CONSTRAINT "ProjectBriefRevision_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectBriefRevision" ADD CONSTRAINT "ProjectBriefRevision_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_sourceIssueId_fkey" FOREIGN KEY ("sourceIssueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_proposedByAgentId_fkey" FOREIGN KEY ("proposedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_decidedByUserId_fkey" FOREIGN KEY ("decidedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContextEntry" ADD CONSTRAINT "ContextEntry_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "ContextEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
