/*
  Warnings:

  - A unique constraint covering the columns `[mongoDbId]` on the table `Worksheet` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Worksheet" ADD COLUMN     "mongoDbId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Worksheet_mongoDbId_key" ON "Worksheet"("mongoDbId");
