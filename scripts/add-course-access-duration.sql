-- Course access duration and enrollment expiration (Course Duration + 1 Calendar Month)
--
-- Course.accessDurationDays: the instructor's configured duration for course access in days.
--   NULL represents self-paced / unlimited lifetime access.
--
-- Enrollment.expiresAt: timestamp when student access ends (enrolledAt + accessDurationDays + 1 calendar month).
--   NULL represents an active enrollment with no expiration date.
--
-- Additive and idempotent. DEFAULT NULL preserves all existing courses and enrollments
-- as lifetime/unlimited access with zero downtime or disruption.
--
-- Applied via `npx prisma db execute --file scripts/add-course-access-duration.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice.
-- Re-runnable.

ALTER TABLE "Course"
  ADD COLUMN IF NOT EXISTS "accessDurationDays" INTEGER DEFAULT NULL;

ALTER TABLE "Enrollment"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS "Enrollment_expiresAt_idx"
  ON "Enrollment"("expiresAt");
