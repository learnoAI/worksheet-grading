-- AlterTable
ALTER TABLE "Worksheet" ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "WorksheetTemplate" (
    "id" TEXT NOT NULL,
    "worksheetNumber" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetTemplateImage" (
    "id" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "worksheetTemplateId" TEXT NOT NULL,

    CONSTRAINT "WorksheetTemplateImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetTemplate_worksheetNumber_key" ON "WorksheetTemplate"("worksheetNumber");

-- AddForeignKey
ALTER TABLE "WorksheetTemplateImage" ADD CONSTRAINT "WorksheetTemplateImage_worksheetTemplateId_fkey" FOREIGN KEY ("worksheetTemplateId") REFERENCES "WorksheetTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Worksheet" ADD CONSTRAINT "Worksheet_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "WorksheetTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
