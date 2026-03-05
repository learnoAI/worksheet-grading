-- CreateEnum
CREATE TYPE "WorksheetBatchStatus" AS ENUM ('PENDING', 'GENERATING_QUESTIONS', 'RENDERING_PDFS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "WorksheetBatch" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "WorksheetBatchStatus" NOT NULL DEFAULT 'PENDING',
    "totalWorksheets" INTEGER NOT NULL DEFAULT 0,
    "completedWorksheets" INTEGER NOT NULL DEFAULT 0,
    "failedWorksheets" INTEGER NOT NULL DEFAULT 0,
    "pendingSkills" INTEGER NOT NULL DEFAULT 0,
    "completedSkills" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorksheetBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "GeneratedWorksheet" ADD COLUMN "batchId" TEXT;

-- CreateIndex
CREATE INDEX "WorksheetBatch_classId_idx" ON "WorksheetBatch"("classId");

-- CreateIndex
CREATE INDEX "WorksheetBatch_status_idx" ON "WorksheetBatch"("status");

-- CreateIndex
CREATE INDEX "GeneratedWorksheet_batchId_status_idx" ON "GeneratedWorksheet"("batchId", "status");

-- AddForeignKey
ALTER TABLE "WorksheetBatch" ADD CONSTRAINT "WorksheetBatch_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedWorksheet" ADD CONSTRAINT "GeneratedWorksheet_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WorksheetBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
