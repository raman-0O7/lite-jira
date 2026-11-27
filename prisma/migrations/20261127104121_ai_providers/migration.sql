-- AlterTable
ALTER TABLE "AiSettings" ADD COLUMN     "baseUrl" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'anthropic',
ADD COLUMN     "structuredOutputs" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "AiUsage" ADD COLUMN     "unpricedRequests" INTEGER NOT NULL DEFAULT 0;
