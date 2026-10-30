-- Rollback of scripts/add-student-onboarding.sql: drops the onboarding column.
-- Remove `onboardingCompletedAt` from prisma/schema.prisma and run
-- `npx prisma generate` before restarting the API, or every query that loads
-- a StudentProfile will ask for a column that no longer exists.
--
-- `npx prisma db execute --file scripts/rollback-student-onboarding.sql`

BEGIN;

ALTER TABLE "StudentProfile" DROP COLUMN IF EXISTS "onboardingCompletedAt";

COMMIT;
