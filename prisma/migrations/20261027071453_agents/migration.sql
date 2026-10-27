-- CreateEnum
CREATE TYPE "AgentKind" AS ENUM ('CLAUDE_CODE', 'MCP');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('QUEUED', 'DISPATCHED', 'RUNNING', 'NEEDS_INPUT', 'PR_OPEN', 'DONE', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "agentId" TEXT;

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AgentKind" NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "configEnc" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "status" "AgentRunStatus" NOT NULL DEFAULT 'QUEUED',
    "externalSessionId" TEXT,
    "sessionUrl" TEXT,
    "prUrl" TEXT,
    "error" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_workspaceId_name_key" ON "Agent"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "AgentRun_issueId_createdAt_idx" ON "AgentRun"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentRun_status_createdAt_idx" ON "AgentRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ApiToken_agentId_idx" ON "ApiToken"("agentId");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_actorAgentId_fkey" FOREIGN KEY ("actorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_assigneeAgentId_fkey" FOREIGN KEY ("assigneeAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_claimedByAgentId_fkey" FOREIGN KEY ("claimedByAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorAgentId_fkey" FOREIGN KEY ("authorAgentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiToken" ADD CONSTRAINT "ApiToken_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
