-- Ensure "Worksheet"."worksheetNumber" exists before the dedup backup runs.
--
-- Background: migration 20250205000000_add_worksheet_number_to_worksheet was
-- recovered from a production hotfix and guards its ALTER with
-- `IF to_regclass('"Worksheet"') IS NOT NULL`. On a fresh database that guard
-- skips (Worksheet does not exist yet), the subsequent init migration creates
-- Worksheet without "worksheetNumber", and no later migration adds it back.
-- Production already has the column from the original out-of-band hotfix, so
-- this no-ops there; on fresh databases it restores the missing column before
-- 20260214122900_backup_duplicate_worksheets references it.

ALTER TABLE "Worksheet"
  ADD COLUMN IF NOT EXISTS "worksheetNumber" INTEGER NOT NULL DEFAULT 0;
