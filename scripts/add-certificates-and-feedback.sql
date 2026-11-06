-- Migration: Add fields for Certificate customization, branding, and comprehensive Student Feedback
-- Safe, additive, idempotent DDL

-- 1. Certificate model extensions
ALTER TABLE "Certificate"
  ADD COLUMN IF NOT EXISTS "grade" TEXT,
  ADD COLUMN IF NOT EXISTS "score" INTEGER,
  ADD COLUMN IF NOT EXISTS "performanceDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "instructorRemarks" TEXT,
  ADD COLUMN IF NOT EXISTS "brandingName" TEXT DEFAULT 'Course Ranger',
  ADD COLUMN IF NOT EXISTS "brandingPoweredBy" TEXT DEFAULT 'Course Powered By SPIPL';

-- 2. Review model extensions (for student feedback)
ALTER TABLE "Review"
  ADD COLUMN IF NOT EXISTS "overallRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "contentQualityRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "quizzesRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "assignmentsRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "syllabusRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "teachingRating" INTEGER,
  ADD COLUMN IF NOT EXISTS "comments" TEXT;

-- Backfill existing rows if overallRating is null and rating exists
UPDATE "Review"
SET "overallRating" = "rating"
WHERE "overallRating" IS NULL AND "rating" IS NOT NULL;
