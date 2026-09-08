-- Adds the indexes documented in PERFORMANCE_AUDIT.md (Phase 8) and now
-- also declared in prisma/schema.prisma. Verified via a live pg_indexes
-- query (2026-09-08) that none of these currently exist on the database,
-- despite the audit's Aug 2026 entry claiming they were already applied.
--
-- Safe to run: purely additive (CREATE INDEX, no drops/alters), IF NOT
-- EXISTS guards make it idempotent, and Postgres index creation doesn't
-- lock out reads. Not run automatically — apply manually when ready:
--   psql "$DATABASE_URL" -f prisma/migrations_pending_review/add_missing_perf_indexes.sql

CREATE INDEX IF NOT EXISTS "Course_creatorId_idx" ON "Course" ("creatorId");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User" ("role");
CREATE INDEX IF NOT EXISTS "CalendarEvent_courseId_idx" ON "CalendarEvent" ("courseId");
CREATE INDEX IF NOT EXISTS "CalendarEvent_instructorId_idx" ON "CalendarEvent" ("instructorId");
CREATE INDEX IF NOT EXISTS "CalendarEvent_date_idx" ON "CalendarEvent" ("date");
