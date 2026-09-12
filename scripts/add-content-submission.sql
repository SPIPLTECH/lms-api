-- ContentSubmission: a student's uploaded PDF for a lesson-composer Assignment
-- block (a Content row with type ASSIGNMENT). Purely additive -- a new table,
-- no existing row is touched.
--
-- Applied via `npx prisma db execute --file scripts/add-content-submission.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice.
-- Re-runnable.

CREATE TABLE IF NOT EXISTS "ContentSubmission" (
  "id"          TEXT         NOT NULL,
  "contentId"   TEXT         NOT NULL,
  "studentId"   TEXT         NOT NULL,
  "status"      TEXT         NOT NULL DEFAULT 'Submitted',
  "grade"       TEXT,
  "feedback"    TEXT,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fileUrl"     TEXT         NOT NULL,
  "fileName"    TEXT         NOT NULL,
  "fileSize"    INTEGER,
  "fileType"    TEXT,
  CONSTRAINT "ContentSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContentSubmission_contentId_fkey"
    FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ContentSubmission_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContentSubmission_studentId_contentId_key"
  ON "ContentSubmission"("studentId", "contentId");
CREATE INDEX IF NOT EXISTS "ContentSubmission_contentId_idx"
  ON "ContentSubmission"("contentId");
