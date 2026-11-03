-- AlterEnum
ALTER TYPE "AgentKind" ADD VALUE 'CLAUDE_API';

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "budgetCents" INTEGER,
ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "syncedAt" TIMESTAMP(3);
