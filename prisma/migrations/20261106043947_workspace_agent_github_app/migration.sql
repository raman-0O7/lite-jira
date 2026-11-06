-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "githubResourceId" TEXT,
ADD COLUMN     "githubTokenAt" TIMESTAMP(3);
