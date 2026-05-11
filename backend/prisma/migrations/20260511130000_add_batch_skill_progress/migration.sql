-- CreateTable
CREATE TABLE "BatchSkillProgress" (
    "batchId" TEXT NOT NULL,
    "mathSkillId" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchSkillProgress_pkey" PRIMARY KEY ("batchId","mathSkillId")
);

-- CreateIndex
CREATE INDEX "BatchSkillProgress_batchId_idx" ON "BatchSkillProgress"("batchId");

-- AddForeignKey
ALTER TABLE "BatchSkillProgress" ADD CONSTRAINT "BatchSkillProgress_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WorksheetBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSkillProgress" ADD CONSTRAINT "BatchSkillProgress_mathSkillId_fkey" FOREIGN KEY ("mathSkillId") REFERENCES "MathSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

