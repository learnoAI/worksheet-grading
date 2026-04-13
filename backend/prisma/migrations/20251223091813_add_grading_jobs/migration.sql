-- CreateEnum
CREATE TYPE "GradingJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "GradingJob" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "worksheetNumber" INTEGER NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "status" "GradingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "worksheetId" TEXT,
    "errorMessage" TEXT,
    "submittedOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "GradingJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GradingJob_teacherId_status_idx" ON "GradingJob"("teacherId", "status");

-- CreateIndex
CREATE INDEX "GradingJob_teacherId_createdAt_idx" ON "GradingJob"("teacherId", "createdAt");

-- CreateIndex
CREATE INDEX "GradingJob_classId_createdAt_idx" ON "GradingJob"("classId", "createdAt");

-- CreateIndex
CREATE INDEX "GradingJob_status_createdAt_idx" ON "GradingJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "GradingJob" ADD CONSTRAINT "GradingJob_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingJob" ADD CONSTRAINT "GradingJob_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradingJob" ADD CONSTRAINT "GradingJob_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
