-- Ties a student's question to the specific content block they asked from,
-- so the instructor's Q&A shows the actual content and the student sees
-- their past questions for that content. Additive: one nullable column, no
-- existing row changes (old questions simply stay lesson-wide).
--
-- Applied via `npx prisma db execute --file scripts/add-lesson-query-content.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice.
-- Re-runnable.

ALTER TABLE "LessonQuery" ADD COLUMN IF NOT EXISTS "contentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "LessonQuery"
    ADD CONSTRAINT "LessonQuery_contentId_fkey"
    FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "LessonQuery_contentId_idx" ON "LessonQuery"("contentId");
