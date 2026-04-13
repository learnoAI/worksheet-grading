-- Historical production hotfix recovered into version control.
--
-- This migration was applied to the production database on 2026-02-05 but the
-- migration directory was not present in the repository. The timestamp sorts
-- before the original 2025-03 init migration, so keep it guarded for fresh
-- databases where "Worksheet" has not been created yet.

DO $$
BEGIN
  IF to_regclass('"Worksheet"') IS NOT NULL THEN
    ALTER TABLE "Worksheet"
      ADD COLUMN IF NOT EXISTS "worksheetNumber" INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;
