-- Unified learning sequence, step 3 of 3: database-enforced invariants.
--
-- Run AFTER `node scripts/migrateContentSequence.js --apply`, which leaves
-- every row satisfying both checks (it verifies them itself before it
-- commits). If a check fails here, the transaction rolls back and nothing
-- changes — re-run the integrity report to see which rows are out of line:
--   node scripts/contentSequenceIntegrityReport.js
--
-- npx prisma db execute --file scripts/content-sequence-2-constraints.sql
-- Re-runnable: each constraint is dropped and re-created.

BEGIN;

-- A Content row hangs off exactly one of the six levels — the rule that makes
-- "the sequence of parent P" mean exactly one set of rows.
ALTER TABLE "Content" DROP CONSTRAINT IF EXISTS "content_exactly_one_parent";
ALTER TABLE "Content" ADD CONSTRAINT "content_exactly_one_parent" CHECK (
  num_nonnulls("courseId", "moduleId", "lessonId", "topicId", "subTopicId", "conceptId") = 1
);

-- type QUIZ        -> quizId set, assignmentId null
-- type ASSIGNMENT  -> assignmentId set, quizId null
-- any other type   -> neither
ALTER TABLE "Content" DROP CONSTRAINT IF EXISTS "content_type_link";
ALTER TABLE "Content" ADD CONSTRAINT "content_type_link" CHECK (
  ("type" = 'QUIZ' AND "quizId" IS NOT NULL AND "assignmentId" IS NULL)
  OR ("type" = 'ASSIGNMENT' AND "assignmentId" IS NOT NULL AND "quizId" IS NULL)
  OR ("type" NOT IN ('QUIZ', 'ASSIGNMENT') AND "quizId" IS NULL AND "assignmentId" IS NULL)
);

COMMIT;
