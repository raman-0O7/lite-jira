-- CreateEnum
CREATE TYPE "GitHubIssueState" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PullRequestState" AS ENUM ('OPEN', 'MERGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ChecksState" AS ENUM ('NONE', 'PENDING', 'PASS', 'FAIL');

-- CreateTable
CREATE TABLE "GitHubInstallation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" INTEGER NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "accountType" TEXT NOT NULL,
    "createdById" TEXT,
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubUserLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "githubUserId" INTEGER NOT NULL,
    "login" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectRepo" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "importAssigned" BOOLEAN NOT NULL DEFAULT true,
    "statusSync" BOOLEAN NOT NULL DEFAULT true,
    "moveOnMerge" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectRepo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubIssueLink" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "projectRepoId" TEXT,
    "repoFullName" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "state" "GitHubIssueState" NOT NULL DEFAULT 'OPEN',
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubIssueLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestLink" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "headSha" TEXT,
    "state" "PullRequestState" NOT NULL DEFAULT 'OPEN',
    "checks" "ChecksState" NOT NULL DEFAULT 'NONE',
    "mergedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequestLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GitHubDelivery" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GitHubDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GitHubInstallation_installationId_key" ON "GitHubInstallation"("installationId");

-- CreateIndex
CREATE INDEX "GitHubInstallation_workspaceId_idx" ON "GitHubInstallation"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubUserLink_userId_key" ON "GitHubUserLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubUserLink_githubUserId_key" ON "GitHubUserLink"("githubUserId");

-- CreateIndex
CREATE INDEX "ProjectRepo_repoFullName_idx" ON "ProjectRepo"("repoFullName");

-- CreateIndex
CREATE INDEX "ProjectRepo_projectId_idx" ON "ProjectRepo"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectRepo_installationId_repoFullName_key" ON "ProjectRepo"("installationId", "repoFullName");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubIssueLink_issueId_key" ON "GitHubIssueLink"("issueId");

-- CreateIndex
CREATE UNIQUE INDEX "GitHubIssueLink_repoFullName_number_key" ON "GitHubIssueLink"("repoFullName", "number");

-- CreateIndex
CREATE INDEX "PullRequestLink_repoFullName_number_idx" ON "PullRequestLink"("repoFullName", "number");

-- CreateIndex
CREATE INDEX "PullRequestLink_repoFullName_headSha_idx" ON "PullRequestLink"("repoFullName", "headSha");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestLink_issueId_repoFullName_number_key" ON "PullRequestLink"("issueId", "repoFullName", "number");

-- AddForeignKey
ALTER TABLE "GitHubInstallation" ADD CONSTRAINT "GitHubInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubUserLink" ADD CONSTRAINT "GitHubUserLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepo" ADD CONSTRAINT "ProjectRepo_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectRepo" ADD CONSTRAINT "ProjectRepo_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubIssueLink" ADD CONSTRAINT "GitHubIssueLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GitHubIssueLink" ADD CONSTRAINT "GitHubIssueLink_projectRepoId_fkey" FOREIGN KEY ("projectRepoId") REFERENCES "ProjectRepo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestLink" ADD CONSTRAINT "PullRequestLink_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
