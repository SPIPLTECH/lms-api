-- Ties a student's question to the quiz or assignment they asked from (the
-- content-block case is add-lesson-query-content.sql), so a question asked
-- about one item is only listed back on that item. Additive: two nullable
-- columns, no existing row changes.
--
-- Applied via `npx prisma db execute --file scripts/add-lesson-query-quiz-assignment.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice.
-- Re-runnable.

ALTER TABLE "LessonQuery" ADD COLUMN IF NOT EXISTS "quizId" TEXT;
ALTER TABLE "LessonQuery" ADD COLUMN IF NOT EXISTS "assignmentId" TEXT;

DO $$ BEGIN
  ALTER TABLE "LessonQuery"
    ADD CONSTRAINT "LessonQuery_quizId_fkey"
    FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "LessonQuery"
    ADD CONSTRAINT "LessonQuery_assignmentId_fkey"
    FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "LessonQuery_quizId_idx" ON "LessonQuery"("quizId");
CREATE INDEX IF NOT EXISTS "LessonQuery_assignmentId_idx" ON "LessonQuery"("assignmentId");
