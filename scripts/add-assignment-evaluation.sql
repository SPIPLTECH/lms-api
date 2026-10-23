-- Assignment auto-evaluation (src/modules/assignment-evaluation).
--
-- Four NEW tables: a marking scheme per assignment, its criteria, the
-- evaluation history of each submission, and a shared synonym dictionary.
-- Additive only: no existing table or column is changed, and no existing row
-- is touched. Assignments without a marking scheme keep working exactly as
-- before (graded by hand).
--
-- Applied via `npx prisma db execute --file scripts/add-assignment-evaluation.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice.
-- Re-runnable.
--
-- NOTE for other branches: these tables are not in their schema.prisma. A
-- `prisma db push` from such a branch would DROP them (and every saved
-- marking scheme and evaluation). Merge this schema first.

CREATE TABLE IF NOT EXISTS "AssignmentRubric" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "idealAnswer" TEXT NOT NULL,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "markStep" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "synonyms" JSONB NOT NULL DEFAULT '[]',
    "misconceptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AssignmentRubric_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssignmentRubricCriterion" (
    "id" TEXT NOT NULL,
    "rubricId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "marks" DOUBLE PRECISION NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "phrases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contradictions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minKeywords" INTEGER,
    CONSTRAINT "AssignmentRubricCriterion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AssignmentEvaluation" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL,
    "engineName" TEXT NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "marksAwarded" DOUBLE PRECISION NOT NULL,
    "maxMarks" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL,
    "reviewReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" JSONB NOT NULL,
    "feedback" JSONB NOT NULL,
    "inputText" TEXT NOT NULL,
    "inputMeta" JSONB NOT NULL DEFAULT '{}',
    "overrideReason" TEXT,
    "instructorComment" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentEvaluation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "EvaluationSynonymGroup" (
    "id" TEXT NOT NULL,
    "terms" TEXT[],
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvaluationSynonymGroup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentRubric_assignmentId_key" ON "AssignmentRubric"("assignmentId");
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentRubricCriterion_rubricId_position_key" ON "AssignmentRubricCriterion"("rubricId", "position");
CREATE INDEX IF NOT EXISTS "AssignmentEvaluation_submissionId_isCurrent_idx" ON "AssignmentEvaluation"("submissionId", "isCurrent");
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentEvaluation_submissionId_version_key" ON "AssignmentEvaluation"("submissionId", "version");

-- Foreign keys: PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, so each one is
-- added only when missing.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentRubric_assignmentId_fkey') THEN
        ALTER TABLE "AssignmentRubric" ADD CONSTRAINT "AssignmentRubric_assignmentId_fkey"
            FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentRubricCriterion_rubricId_fkey') THEN
        ALTER TABLE "AssignmentRubricCriterion" ADD CONSTRAINT "AssignmentRubricCriterion_rubricId_fkey"
            FOREIGN KEY ("rubricId") REFERENCES "AssignmentRubric"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluation_submissionId_fkey') THEN
        ALTER TABLE "AssignmentEvaluation" ADD CONSTRAINT "AssignmentEvaluation_submissionId_fkey"
            FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluation_createdById_fkey') THEN
        ALTER TABLE "AssignmentEvaluation" ADD CONSTRAINT "AssignmentEvaluation_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EvaluationSynonymGroup_createdById_fkey') THEN
        ALTER TABLE "EvaluationSynonymGroup" ADD CONSTRAINT "EvaluationSynonymGroup_createdById_fkey"
            FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
