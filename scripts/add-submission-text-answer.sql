-- Written answers for assignment submissions. A student may now submit a PDF,
-- a typed/pasted answer, or both (at least one is enforced by the API).
-- Additive: one nullable column per table, and ContentSubmission's file
-- columns become optional. No existing row changes.
--
-- Applied via `npx prisma db execute --file scripts/add-submission-text-answer.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice.
-- Re-runnable.

ALTER TABLE "AssignmentSubmission" ADD COLUMN IF NOT EXISTS "textAnswer" TEXT;
ALTER TABLE "ContentSubmission" ADD COLUMN IF NOT EXISTS "textAnswer" TEXT;
ALTER TABLE "ContentSubmission" ALTER COLUMN "fileUrl" DROP NOT NULL;
ALTER TABLE "ContentSubmission" ALTER COLUMN "fileName" DROP NOT NULL;
