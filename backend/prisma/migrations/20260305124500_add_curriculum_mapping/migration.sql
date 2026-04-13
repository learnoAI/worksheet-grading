-- CreateTable
CREATE TABLE "MainTopic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MainTopic_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "MathSkill" ADD COLUMN "mainTopicId" TEXT;

-- CreateTable
CREATE TABLE "WorksheetSkillMap" (
    "id" TEXT NOT NULL,
    "worksheetNumber" INTEGER NOT NULL,
    "mathSkillId" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorksheetSkillMap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MainTopic_name_key" ON "MainTopic"("name");

-- CreateIndex
CREATE INDEX "MathSkill_mainTopicId_idx" ON "MathSkill"("mainTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "math_skill_name_main_topic_unique" ON "MathSkill"("name", "mainTopicId");

-- CreateIndex
CREATE UNIQUE INDEX "WorksheetSkillMap_worksheetNumber_key" ON "WorksheetSkillMap"("worksheetNumber");

-- CreateIndex
CREATE INDEX "WorksheetSkillMap_mathSkillId_idx" ON "WorksheetSkillMap"("mathSkillId");

-- CreateIndex
CREATE INDEX "WorksheetSkillMap_isTest_idx" ON "WorksheetSkillMap"("isTest");

-- AddForeignKey
ALTER TABLE "MathSkill" ADD CONSTRAINT "MathSkill_mainTopicId_fkey" FOREIGN KEY ("mainTopicId") REFERENCES "MainTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorksheetSkillMap" ADD CONSTRAINT "WorksheetSkillMap_mathSkillId_fkey" FOREIGN KEY ("mathSkillId") REFERENCES "MathSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
