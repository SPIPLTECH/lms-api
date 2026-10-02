-- Unified learning sequence, step 1 of 3: schema (additive).
--
-- Content becomes THE learning-sequence entity: a Quiz or an Assignment takes
-- part in a sequence through the Content row that wraps it —
-- Content(type=QUIZ, quizId) / Content(type=ASSIGNMENT, assignmentId) — and
-- Content.order is the only sequence order.
--
-- Run order:
--   1. npx prisma db execute --file scripts/content-sequence-1-schema.sql
--   2. node scripts/migrateContentSequence.js            (dry run, rolled back)
--      node scripts/migrateContentSequence.js --apply    (writes; backs up first)
--   3. npx prisma db execute --file scripts/content-sequence-2-constraints.sql
--
-- Applied with `prisma db execute`, never `db push` / `migrate dev`, per this
-- project's DB-safety practice. Re-runnable: every statement is a no-op when
-- its change is already in place (the shared database already received the
-- wrapper columns through an earlier `db push`).
--
-- Nothing here removes data or a column. Quiz.order, Assignment.order and the
-- ContentSubmission table become unused but stay, so branches still deployed
-- against the shared database keep working; drop them once all have merged.

-- An enum value cannot be used in the transaction that adds it, so this runs
-- on its own, before the transaction below.
ALTER TYPE "ContentType" ADD VALUE IF NOT EXISTS 'QUIZ';

BEGIN;

-- Content -> the Quiz / Assignment it places. One Content row per Quiz /
-- Assignment at most (unique), removed with it (cascade).
ALTER TABLE "Content" ADD COLUMN IF NOT EXISTS "quizId" TEXT;
ALTER TABLE "Content" ADD COLUMN IF NOT EXISTS "assignmentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Content_quizId_key" ON "Content"("quizId");
CREATE UNIQUE INDEX IF NOT EXISTS "Content_assignmentId_key" ON "Content"("assignmentId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Content_quizId_fkey') THEN
    ALTER TABLE "Content" ADD CONSTRAINT "Content_quizId_fkey"
      FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Content_assignmentId_fkey') THEN
    ALTER TABLE "Content" ADD CONSTRAINT "Content_assignmentId_fkey"
      FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- A lesson-composer assignment block becomes a real Assignment, and such a
-- block never had a due date. Dropping NOT NULL changes no existing row.
ALTER TABLE "Assignment" ALTER COLUMN "dueDate" DROP NOT NULL;

COMMIT;
