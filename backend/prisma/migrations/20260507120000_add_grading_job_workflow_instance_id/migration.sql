-- AlterTable
ALTER TABLE "GradingJob" ADD COLUMN "workflowInstanceId" TEXT;

-- CreateIndex
CREATE INDEX "GradingJob_workflowInstanceId_idx" ON "GradingJob"("workflowInstanceId");
