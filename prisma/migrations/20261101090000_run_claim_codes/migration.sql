-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "claimCodeHash" TEXT,
ADD COLUMN     "runnerUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AgentRun_claimCodeHash_key" ON "AgentRun"("claimCodeHash");

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_runnerUserId_fkey" FOREIGN KEY ("runnerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

