-- Drop old constraint (exists as a table constraint, not just an index)
ALTER TABLE "Worksheet" DROP CONSTRAINT IF EXISTS "unique_worksheet_per_student_day";
ALTER TABLE "Worksheet" DROP CONSTRAINT IF EXISTS "Worksheet_studentId_classId_worksheetNumber_submittedOn_key";
ALTER TABLE "Worksheet" DROP CONSTRAINT IF EXISTS "Worksheet_studentId_classId_templateId_submittedOn_key";

-- Also drop as indexes in case they exist as standalone indexes
DROP INDEX IF EXISTS "unique_worksheet_per_student_day";
DROP INDEX IF EXISTS "Worksheet_studentId_classId_worksheetNumber_submittedOn_key";
DROP INDEX IF EXISTS "Worksheet_studentId_classId_templateId_submittedOn_key";

-- CreateIndex (correct constraint matching the Prisma schema)
CREATE UNIQUE INDEX "Worksheet_studentId_classId_templateId_submittedOn_key" ON "Worksheet"("studentId", "classId", "templateId", "submittedOn");
