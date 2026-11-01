-- AlterTable
ALTER TABLE "Attachment" ALTER COLUMN "commentId" DROP NOT NULL,
ADD COLUMN     "issueId" TEXT,
ADD COLUMN     "sourceUrl" TEXT;

-- CreateIndex
CREATE INDEX "Attachment_issueId_idx" ON "Attachment"("issueId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
