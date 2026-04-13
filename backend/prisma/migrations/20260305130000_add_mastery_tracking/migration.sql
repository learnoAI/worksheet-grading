-- CreateEnum
CREATE TYPE "MasteryLevel" AS ENUM ('NOT_STARTED', 'ATTEMPTED', 'FAMILIAR', 'PROFICIENT', 'MASTERED');

-- CreateTable
CREATE TABLE "StudentSkillMastery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "mathSkillId" TEXT NOT NULL,
    "masteryLevel" "MasteryLevel" NOT NULL DEFAULT 'NOT_STARTED',
    "stability" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "difficulty" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "lastPracticeAt" TIMESTAMP(3),
    "lastScore" DOUBLE PRECISION,
    "practiceCount" INTEGER NOT NULL DEFAULT 0,
    "testCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentSkillMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillPracticeLog" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "mathSkillId" TEXT NOT NULL,
    "worksheetId" TEXT NOT NULL,
    "worksheetNumber" INTEGER NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "score" DOUBLE PRECISION NOT NULL,
    "rawGrade" DOUBLE PRECISION NOT NULL,
    "rawOutOf" DOUBLE PRECISION NOT NULL,
    "previousLevel" "MasteryLevel" NOT NULL,
    "newLevel" "MasteryLevel" NOT NULL,
    "stabilityAfter" DOUBLE PRECISION NOT NULL,
    "difficultyAfter" DOUBLE PRECISION NOT NULL,
    "practicedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkillPracticeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentSkillMastery_studentId_mathSkillId_key" ON "StudentSkillMastery"("studentId", "mathSkillId");

-- CreateIndex
CREATE INDEX "StudentSkillMastery_studentId_masteryLevel_idx" ON "StudentSkillMastery"("studentId", "masteryLevel");

-- CreateIndex
CREATE INDEX "StudentSkillMastery_mathSkillId_idx" ON "StudentSkillMastery"("mathSkillId");

-- CreateIndex
CREATE INDEX "StudentSkillMastery_studentId_lastPracticeAt_idx" ON "StudentSkillMastery"("studentId", "lastPracticeAt");

-- CreateIndex
CREATE INDEX "SkillPracticeLog_studentId_mathSkillId_practicedAt_idx" ON "SkillPracticeLog"("studentId", "mathSkillId", "practicedAt");

-- CreateIndex
CREATE INDEX "SkillPracticeLog_worksheetId_idx" ON "SkillPracticeLog"("worksheetId");

-- AddForeignKey
ALTER TABLE "StudentSkillMastery" ADD CONSTRAINT "StudentSkillMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentSkillMastery" ADD CONSTRAINT "StudentSkillMastery_mathSkillId_fkey" FOREIGN KEY ("mathSkillId") REFERENCES "MathSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillPracticeLog" ADD CONSTRAINT "SkillPracticeLog_worksheetId_fkey" FOREIGN KEY ("worksheetId") REFERENCES "Worksheet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillPracticeLog" ADD CONSTRAINT "SkillPracticeLog_studentId_mathSkillId_fkey" FOREIGN KEY ("studentId", "mathSkillId") REFERENCES "StudentSkillMastery"("studentId", "mathSkillId") ON DELETE RESTRICT ON UPDATE CASCADE;
