-- Course.sequentialLearning: the instructor's on/off switch for sequential
-- learning (students finish each item before the next one opens).
-- Additive and idempotent. DEFAULT true keeps every existing course locked
-- exactly as it is today, and branches whose Prisma schema lacks the column
-- simply never read it.
ALTER TABLE "Course" ADD COLUMN IF NOT EXISTS "sequentialLearning" BOOLEAN NOT NULL DEFAULT true;
