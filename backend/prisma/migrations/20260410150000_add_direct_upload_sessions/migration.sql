-- CreateEnum
CREATE TYPE "WorksheetUploadBatchStatus" AS ENUM ('UPLOADING', 'FINALIZED');

-- CreateEnum
CREATE TYPE "WorksheetUploadItemStatus" AS ENUM ('PENDING', 'QUEUED', 'FAILED');

-- CreateTable
CREATE TABLE "WorksheetUploadBatch" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "submittedOn" TIMESTAMP(3) NOT NULL,
    "status" "WorksheetUploadBatchStatus" NOT NULL DEFAULT 'UPLOADING',
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetUploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetUploadItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "studentName" TEXT NOT NULL,
    "tokenNo" TEXT,
    "worksheetNumber" INTEGER NOT NULL,
    "worksheetName" TEXT,
    "isRepeated" BOOLEAN NOT NULL DEFAULT false,
    "status" "WorksheetUploadItemStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetUploadItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetUploadImage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "storageProvider" "StorageProvider" NOT NULL DEFAULT 'R2',
    "imageUrl" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER,
    "originalName" TEXT,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorksheetUploadImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorksheetUploadBatch_teacherId_classId_submittedOn_idx" ON "WorksheetUploadBatch"("teacherId", "classId", "submittedOn");

-- CreateIndex
CREATE INDEX "WorksheetUploadBatch_status_updatedAt_idx" ON "WorksheetUploadBatch"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetUploadItem_batchId_studentId_worksheetNumber_key" ON "WorksheetUploadItem"("batchId", "studentId", "worksheetNumber");

-- CreateIndex
CREATE INDEX "WorksheetUploadItem_studentId_status_idx" ON "WorksheetUploadItem"("studentId", "status");

-- CreateIndex
CREATE INDEX "WorksheetUploadItem_jobId_idx" ON "WorksheetUploadItem"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetUploadImage_itemId_pageNumber_key" ON "WorksheetUploadImage"("itemId", "pageNumber");

-- CreateIndex
CREATE INDEX "WorksheetUploadImage_s3Key_idx" ON "WorksheetUploadImage"("s3Key");

-- AddForeignKey
ALTER TABLE "WorksheetUploadBatch" ADD CONSTRAINT "WorksheetUploadBatch_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetUploadBatch" ADD CONSTRAINT "WorksheetUploadBatch_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetUploadItem" ADD CONSTRAINT "WorksheetUploadItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WorksheetUploadBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetUploadItem" ADD CONSTRAINT "WorksheetUploadItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetUploadImage" ADD CONSTRAINT "WorksheetUploadImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "WorksheetUploadItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
