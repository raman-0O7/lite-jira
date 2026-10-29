-- Import mode replaces the importAssigned flag (true → ASSIGNED, false → OFF).
CREATE TYPE "GitHubImport" AS ENUM ('ALL', 'ASSIGNED', 'OFF');
ALTER TABLE "ProjectRepo" ADD COLUMN "importIssues" "GitHubImport" NOT NULL DEFAULT 'ALL';
UPDATE "ProjectRepo" SET "importIssues" = CASE WHEN "importAssigned" THEN 'ASSIGNED'::"GitHubImport" ELSE 'OFF'::"GitHubImport" END;
ALTER TABLE "ProjectRepo" DROP COLUMN "importAssigned";
ALTER TABLE "ProjectRepo" ADD COLUMN "lastSyncedAt" TIMESTAMP(3);

-- Images on comments.
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Attachment_commentId_idx" ON "Attachment"("commentId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
