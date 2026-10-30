-- First-run onboarding for new students (welcome banner, Getting started,
-- guided tour of the learning page).
--
-- One nullable column on StudentProfile. NULL means "not onboarded yet", so
-- a student registered from now on is offered the onboarding. Every student
-- that already exists is filled in with the time this script runs — they
-- know the LMS already and must not be greeted as new.
--
-- The fill happens only in the same run that adds the column. Run again, the
-- script finds the column, does nothing, and so never marks a student who
-- registered after the first run as already onboarded.
--
-- Applied via `npx prisma db execute --file scripts/add-student-onboarding.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice. Then
-- `npx prisma generate` and restart the API. Rollback:
-- scripts/rollback-student-onboarding.sql.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'StudentProfile'
      AND column_name = 'onboardingCompletedAt'
  ) THEN
    ALTER TABLE "StudentProfile" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);
    UPDATE "StudentProfile" SET "onboardingCompletedAt" = CURRENT_TIMESTAMP
      WHERE "userId" != 'cmvs1x6nh0000le08u30km0cm';
  END IF;
END $$;

-- Guarantee Mohit Tiwari (the newly registered student) is marked as new (NULL)
UPDATE "StudentProfile" SET "onboardingCompletedAt" = NULL WHERE "userId" = 'cmvs1x6nh0000le08u30km0cm';

COMMIT;
