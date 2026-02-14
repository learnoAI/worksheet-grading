DO $$
BEGIN
  -- This enum was added after the initial GradingJobImage table was created.
  -- Guard to avoid failures if the type already exists (e.g. in newer environments).
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StorageProvider') THEN
    CREATE TYPE "StorageProvider" AS ENUM ('S3', 'R2');
  END IF;
END $$;

ALTER TABLE "GradingJobImage"
  ADD COLUMN IF NOT EXISTS "storageProvider" "StorageProvider";

-- Backfill existing rows (and any rows created before this migration if column existed nullable).
UPDATE "GradingJobImage"
SET "storageProvider" = 'S3'
WHERE "storageProvider" IS NULL;

ALTER TABLE "GradingJobImage"
  ALTER COLUMN "storageProvider" SET DEFAULT 'S3',
  ALTER COLUMN "storageProvider" SET NOT NULL;

