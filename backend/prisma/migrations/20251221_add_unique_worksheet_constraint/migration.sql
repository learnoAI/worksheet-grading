-- CreateIndex: Partial unique index to prevent duplicate worksheets per student per day
-- Only applies when isRepeated = false (intentional repeats are allowed)
-- Uses DATE() function for day-level comparison (ignores time component)

CREATE UNIQUE INDEX "unique_student_worksheet_per_day" 
ON "Worksheet" ("studentId", "classId", "templateId", (DATE("submittedOn")))
WHERE "isRepeated" = false AND "studentId" IS NOT NULL AND "templateId" IS NOT NULL AND "submittedOn" IS NOT NULL;
