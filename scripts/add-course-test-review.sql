-- Course.testReview: test-series feedback settings (merged from the ayan branch).
-- { enabled, weakThreshold, purchaseUrl, sections: { [moduleId]: { label, course } } }
-- NULL = off, so every existing course behaves exactly as before.
-- Additive and idempotent; undo with rollback-course-test-review.sql.
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "testReview" JSONB;
