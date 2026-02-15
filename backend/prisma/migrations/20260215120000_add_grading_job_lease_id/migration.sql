-- Add a per-processing lease token so stale workers can't heartbeat/complete/fail jobs they no longer own.

ALTER TABLE "GradingJob"
  ADD COLUMN IF NOT EXISTS "leaseId" TEXT;
