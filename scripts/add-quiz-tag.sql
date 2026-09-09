-- Quiz Tags: SELF_TEST (learner practice, never timed) vs FINAL (the formal
-- assessment of its lesson/module, optionally timed).
--
-- Every quiz that exists today was authored as a timed, graded assessment,
-- so FINAL is not merely a safe default here -- it is the factually correct
-- value for all existing rows. That makes the column default the backfill:
-- one statement, no second pass.
--
-- Applied via `npx prisma db execute --file scripts/add-quiz-tag.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice.
-- Re-runnable.

DO $$ BEGIN
  CREATE TYPE "QuizTag" AS ENUM ('SELF_TEST', 'FINAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Quiz"
  ADD COLUMN IF NOT EXISTS "quizTag" "QuizTag" NOT NULL DEFAULT 'FINAL';
