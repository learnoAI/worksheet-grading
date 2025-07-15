-- AlterTable
ALTER TABLE "Worksheet" ADD COLUMN     "gradingDetails" JSONB,
ADD COLUMN     "isCorrectGrade" BOOLEAN NOT NULL DEFAULT false;
