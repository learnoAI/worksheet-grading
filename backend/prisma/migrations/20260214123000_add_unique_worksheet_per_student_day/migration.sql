-- The Prisma schema defines @@unique([studentId, classId, worksheetNumber, submittedOn], name: "unique_worksheet_per_student_day")
-- but older databases may not have the underlying unique index. Prisma upsert relies on it.
--
-- Before adding the unique index we deduplicate existing rows that would violate the constraint.
-- We keep the most recently updated row (ties broken by createdAt/id).

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "studentId", "classId", "worksheetNumber", "submittedOn"
      ORDER BY "updatedAt" DESC NULLS LAST, "createdAt" DESC NULLS LAST, id DESC
    ) AS rn
  FROM "Worksheet"
  WHERE "studentId" IS NOT NULL
    AND "submittedOn" IS NOT NULL
)
DELETE FROM "Worksheet" w
USING ranked r
WHERE w.id = r.id
  AND r.rn > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'unique_worksheet_per_student_day'
  ) THEN
    CREATE UNIQUE INDEX "unique_worksheet_per_student_day"
      ON "Worksheet" ("studentId", "classId", "worksheetNumber", "submittedOn");
  END IF;
END $$;

