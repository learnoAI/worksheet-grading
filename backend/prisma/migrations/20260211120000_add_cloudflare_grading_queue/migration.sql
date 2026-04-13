-- AlterTable
ALTER TABLE "GradingJob"
  ADD COLUMN "worksheetName" TEXT,
  ADD COLUMN "tokenNo" TEXT,
  ADD COLUMN "isRepeated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dispatchError" TEXT,
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "enqueuedAt" TIMESTAMP(3),
  ADD COLUMN "startedAt" TIMESTAMP(3),
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "lastErrorAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GradingJobImage" (
  "id" TEXT NOT NULL,
  "gradingJobId" TEXT NOT NULL,
  "imageUrl" TEXT NOT NULL,
  "s3Key" TEXT NOT NULL,
  "pageNumber" INTEGER NOT NULL,
  "mimeType" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GradingJobImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradingJob_status_enqueuedAt_idx" ON "GradingJob"("status", "enqueuedAt");

-- CreateIndex
CREATE INDEX "GradingJob_status_lastHeartbeatAt_idx" ON "GradingJob"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "GradingJobImage_gradingJobId_pageNumber_idx" ON "GradingJobImage"("gradingJobId", "pageNumber");

-- AddForeignKey
ALTER TABLE "GradingJobImage" ADD CONSTRAINT "GradingJobImage_gradingJobId_fkey"
FOREIGN KEY ("gradingJobId") REFERENCES "GradingJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
