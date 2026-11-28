-- AlterEnum
ALTER TYPE "AgentKind" ADD VALUE 'OPENAI_API';

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "runCredentialId" TEXT,
ADD COLUMN     "runVaultId" TEXT;
