-- Backup duplicate Worksheet rows (and related rows) before we deduplicate.
--
-- Why: the subsequent migration `20260214123000_add_unique_worksheet_per_student_day`
-- deletes duplicates to allow creating a unique index. This backup keeps an audit trail
-- so data can be recovered if needed.

CREATE TABLE IF NOT EXISTS "WorksheetDedupBackup" (
  "tableName" TEXT NOT NULL,
  "rowId" TEXT NOT NULL,
  "row" JSONB NOT NULL,
  "backedUpAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WorksheetDedupBackup_pkey" PRIMARY KEY ("tableName", "rowId")
);

CREATE INDEX IF NOT EXISTS "WorksheetDedupBackup_tableName_idx" ON "WorksheetDedupBackup"("tableName");
CREATE INDEX IF NOT EXISTS "WorksheetDedupBackup_backedUpAt_idx" ON "WorksheetDedupBackup"("backedUpAt");

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
),
duplicates AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
INSERT INTO "WorksheetDedupBackup" ("tableName", "rowId", "row")
SELECT 'Worksheet', w.id, to_jsonb(w)
FROM "Worksheet" w
JOIN duplicates d ON d.id = w.id
ON CONFLICT ("tableName", "rowId") DO NOTHING;

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
),
duplicates AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
INSERT INTO "WorksheetDedupBackup" ("tableName", "rowId", "row")
SELECT 'WorksheetImage', wi.id, to_jsonb(wi)
FROM "WorksheetImage" wi
JOIN duplicates d ON d.id = wi."worksheetId"
ON CONFLICT ("tableName", "rowId") DO NOTHING;

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
),
duplicates AS (
  SELECT id
  FROM ranked
  WHERE rn > 1
)
INSERT INTO "WorksheetDedupBackup" ("tableName", "rowId", "row")
SELECT 'WorksheetQuestion', wq.id, to_jsonb(wq)
FROM "WorksheetQuestion" wq
JOIN duplicates d ON d.id = wq."worksheetId"
ON CONFLICT ("tableName", "rowId") DO NOTHING;
