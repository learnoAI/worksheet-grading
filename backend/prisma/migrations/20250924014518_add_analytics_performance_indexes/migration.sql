-- CreateIndex
CREATE INDEX "Worksheet_createdAt_idx" ON "Worksheet"("createdAt");

-- CreateIndex
CREATE INDEX "Worksheet_submittedOn_idx" ON "Worksheet"("submittedOn");

-- CreateIndex
CREATE INDEX "Worksheet_classId_createdAt_idx" ON "Worksheet"("classId", "createdAt");

-- CreateIndex
CREATE INDEX "Worksheet_studentId_submittedOn_idx" ON "Worksheet"("studentId", "submittedOn");

-- CreateIndex
CREATE INDEX "Worksheet_isAbsent_createdAt_idx" ON "Worksheet"("isAbsent", "createdAt");

-- CreateIndex
CREATE INDEX "Worksheet_isRepeated_createdAt_idx" ON "Worksheet"("isRepeated", "createdAt");

-- CreateIndex
CREATE INDEX "Worksheet_grade_outOf_isAbsent_idx" ON "Worksheet"("grade", "outOf", "isAbsent");
