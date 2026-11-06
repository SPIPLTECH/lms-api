-- Migration: Add Certificate Template & Course Memo fields to Course and Certificate models
-- Safe, additive, idempotent DDL

-- 1. Course model extensions for certificate template and reusable course memo
ALTER TABLE "Course"
  ADD COLUMN IF NOT EXISTS "certificateTitle" TEXT DEFAULT 'Certificate of Completion',
  ADD COLUMN IF NOT EXISTS "certificateDescription" TEXT,
  ADD COLUMN IF NOT EXISTS "courseMemo" TEXT,
  ADD COLUMN IF NOT EXISTS "certificateTemplate" JSONB;

-- 2. Certificate model extension for snapshot of course memo
ALTER TABLE "Certificate"
  ADD COLUMN IF NOT EXISTS "courseMemo" TEXT;
