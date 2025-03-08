/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `Worksheet` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Worksheet" DROP COLUMN "imageUrl";

-- CreateTable
CREATE TABLE "WorksheetImage" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorksheetImage_worksheetId_pageNumber_idx" ON "WorksheetImage"("worksheetId", "pageNumber");

-- AddForeignKey
ALTER TABLE "WorksheetImage" ADD CONSTRAINT "WorksheetImage_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
