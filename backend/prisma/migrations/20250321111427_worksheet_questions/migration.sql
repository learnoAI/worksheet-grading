-- AlterTable
ALTER TABLE "Worksheet" ADD COLUMN     "outOf" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "MathSkill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MathSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetTemplateQuestion" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "worksheetTemplateId" TEXT NOT NULL,
    "answer" TEXT,
    "outOf" DOUBLE PRECISION DEFAULT 1,

    CONSTRAINT "WorksheetTemplateQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorksheetQuestion" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,

    CONSTRAINT "WorksheetQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_MathSkillToWorksheetTemplateQuestion" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_MathSkillToWorksheetTemplateQuestion_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_WorksheetTemplateToWorksheetTemplateQuestion" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_WorksheetTemplateToWorksheetTemplateQuestion_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_MathSkillToWorksheetTemplateQuestion_B_index" ON "_MathSkillToWorksheetTemplateQuestion"("B");

-- CreateIndex
CREATE INDEX "_WorksheetTemplateToWorksheetTemplateQuestion_B_index" ON "_WorksheetTemplateToWorksheetTemplateQuestion"("B");

-- AddForeignKey
ALTER TABLE "WorksheetQuestion" ADD CONSTRAINT "WorksheetQuestion_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetQuestion" ADD CONSTRAINT "WorksheetQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "WorksheetTemplateQuestion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MathSkillToWorksheetTemplateQuestion" ADD CONSTRAINT "_MathSkillToWorksheetTemplateQuestion_A_fkey" FOREIGN KEY ("A") REFERENCES "MathSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MathSkillToWorksheetTemplateQuestion" ADD CONSTRAINT "_MathSkillToWorksheetTemplateQuestion_B_fkey" FOREIGN KEY ("B") REFERENCES "WorksheetTemplateQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorksheetTemplateToWorksheetTemplateQuestion" ADD CONSTRAINT "_WorksheetTemplateToWorksheetTemplateQuestion_A_fkey" FOREIGN KEY ("A") REFERENCES "WorksheetTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WorksheetTemplateToWorksheetTemplateQuestion" ADD CONSTRAINT "_WorksheetTemplateToWorksheetTemplateQuestion_B_fkey" FOREIGN KEY ("B") REFERENCES "WorksheetTemplateQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
