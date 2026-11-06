-- A student's choice to take a proctored quiz without proctoring. Additive only: one
-- new table; no existing table, column, row or index is changed.
-- Rollback: scripts/proctoring/002_proctoring_opt_out.down.sql
--
-- IMPORTANT: apply this BEFORE deploying code built from this schema. The exam status,
-- the quiz screen and quiz submission read this table for every proctored quiz.

BEGIN;

CREATE TABLE IF NOT EXISTS "ProctoringOptOut" (
  "id" TEXT NOT NULL,
  "quizId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProctoringOptOut_pkey" PRIMARY KEY ("id")
);

-- One choice per student and quiz.
CREATE UNIQUE INDEX IF NOT EXISTS "ProctoringOptOut_studentId_quizId_key" ON "ProctoringOptOut" ("studentId", "quizId");

-- The choice goes with its quiz or student; it never stops either being deleted.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProctoringOptOut_quizId_fkey') THEN
    ALTER TABLE "ProctoringOptOut" ADD CONSTRAINT "ProctoringOptOut_quizId_fkey"
      FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProctoringOptOut_studentId_fkey') THEN
    ALTER TABLE "ProctoringOptOut" ADD CONSTRAINT "ProctoringOptOut_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
