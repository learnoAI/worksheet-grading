-- CreateEnum
CREATE TYPE "GeneratedWorksheetStatus" AS ENUM ('PENDING', 'QUESTIONS_READY', 'RENDERING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "QuestionBank" (
    "id" TEXT NOT NULL,
    "mathSkillId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedWorksheet" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "pdfUrl" TEXT,
    "status" "GeneratedWorksheetStatus" NOT NULL DEFAULT 'PENDING',
    "newSkillId" TEXT NOT NULL,
    "reviewSkill1Id" TEXT NOT NULL,
    "reviewSkill2Id" TEXT NOT NULL,
    "sectionsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneratedWorksheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionBank_mathSkillId_usedCount_idx" ON "QuestionBank"("mathSkillId", "usedCount");

-- CreateIndex
CREATE INDEX "GeneratedWorksheet_studentId_scheduledDate_idx" ON "GeneratedWorksheet"("studentId", "scheduledDate");

-- CreateIndex
CREATE INDEX "GeneratedWorksheet_status_idx" ON "GeneratedWorksheet"("status");

-- AddForeignKey
ALTER TABLE "QuestionBank" ADD CONSTRAINT "QuestionBank_mathSkillId_fkey" FOREIGN KEY ("mathSkillId") REFERENCES "MathSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedWorksheet" ADD CONSTRAINT "GeneratedWorksheet_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
