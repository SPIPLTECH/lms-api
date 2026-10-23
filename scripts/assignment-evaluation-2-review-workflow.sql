-- Assignment auto-evaluation, step 2: instructor approval, versioning, a
-- durable job queue and an audit trail (src/modules/assignment-evaluation).
-- Requires scripts/add-assignment-evaluation.sql to have run first.
--
-- Additive only: new columns with defaults, two new tables, new indexes and
-- checks. No existing column is dropped or retyped and no row is deleted.
-- The one data statement switches off automatic publishing, which this
-- version no longer supports (results are published only by an instructor).
--
-- Apply with `npx prisma db execute --file scripts/assignment-evaluation-2-review-workflow.sql`
-- against a development database first. Never `db push`: the partial unique
-- indexes and CHECK constraints below cannot be expressed in schema.prisma, so
-- a push would drop them. Re-runnable.

-- ─── Versions ──────────────────────────────────────────────────────────────

-- Bumped on every save of the marking scheme. Evaluations record the version
-- they were computed with, so a result from an older scheme can be detected.
ALTER TABLE "AssignmentRubric" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AssignmentEvaluation" ADD COLUMN IF NOT EXISTS "rubricVersion" INTEGER;
-- The submission's submittedAt when it was evaluated: identifies which
-- version of the student's work (resubmissions replace the row) was marked.
ALTER TABLE "AssignmentEvaluation" ADD COLUMN IF NOT EXISTS "submissionSubmittedAt" TIMESTAMP(3);

-- ─── Publication ───────────────────────────────────────────────────────────

-- The evaluation whose marks the student sees. Only an instructor decision
-- can be published, and at most one per submission. Who published it is the
-- version's createdById: a published version is always created by the
-- instructor who published it. (A second ON DELETE SET NULL key to "User" on
-- this table would make deleting an instructor fail: PostgreSQL reports an FK
-- violation when one row is reached by two SET NULL actions and a cascade.)
ALTER TABLE "AssignmentEvaluation" ADD COLUMN IF NOT EXISTS "isPublished" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AssignmentEvaluation" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMP(3);

UPDATE "AssignmentRubric" SET "autoPublish" = false WHERE "autoPublish" = true;

-- ─── Job queue ─────────────────────────────────────────────────────────────

-- One row per submission. Survives restarts: the worker claims QUEUED rows
-- (and PROCESSING rows whose lock has gone stale) with FOR UPDATE SKIP LOCKED.
CREATE TABLE IF NOT EXISTS "AssignmentEvaluationJob" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "reason" TEXT NOT NULL,
    "allowFinalized" BOOLEAN NOT NULL DEFAULT false,
    "rerun" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentEvaluationJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentEvaluationJob_submissionId_key" ON "AssignmentEvaluationJob"("submissionId");
CREATE INDEX IF NOT EXISTS "AssignmentEvaluationJob_status_runAfter_idx" ON "AssignmentEvaluationJob"("status", "runAfter");

-- ─── Audit trail ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "AssignmentEvaluationAudit" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "evaluationId" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssignmentEvaluationAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AssignmentEvaluationAudit_submissionId_createdAt_idx" ON "AssignmentEvaluationAudit"("submissionId", "createdAt");

-- ─── Integrity rules schema.prisma cannot express ──────────────────────────

-- Exactly one current and at most one published evaluation per submission,
-- even under concurrent writers.
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentEvaluation_one_current_key"
    ON "AssignmentEvaluation"("submissionId") WHERE "isCurrent";
CREATE UNIQUE INDEX IF NOT EXISTS "AssignmentEvaluation_one_published_key"
    ON "AssignmentEvaluation"("submissionId") WHERE "isPublished";

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluation_marks_check') THEN
        ALTER TABLE "AssignmentEvaluation" ADD CONSTRAINT "AssignmentEvaluation_marks_check"
            CHECK ("maxMarks" > 0 AND "marksAwarded" >= 0 AND "marksAwarded" <= "maxMarks");
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluation_source_check') THEN
        ALTER TABLE "AssignmentEvaluation" ADD CONSTRAINT "AssignmentEvaluation_source_check"
            CHECK ("source" IN ('AUTO', 'INSTRUCTOR'));
    END IF;
    -- Automated results are proposals: only an instructor decision is ever published.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluation_published_check') THEN
        ALTER TABLE "AssignmentEvaluation" ADD CONSTRAINT "AssignmentEvaluation_published_check"
            CHECK (NOT "isPublished" OR ("source" = 'INSTRUCTOR' AND "publishedAt" IS NOT NULL));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluationJob_status_check') THEN
        ALTER TABLE "AssignmentEvaluationJob" ADD CONSTRAINT "AssignmentEvaluationJob_status_check"
            CHECK ("status" IN ('QUEUED', 'PROCESSING', 'DONE', 'FAILED'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluationJob_submissionId_fkey') THEN
        ALTER TABLE "AssignmentEvaluationJob" ADD CONSTRAINT "AssignmentEvaluationJob_submissionId_fkey"
            FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluationJob_requestedById_fkey') THEN
        ALTER TABLE "AssignmentEvaluationJob" ADD CONSTRAINT "AssignmentEvaluationJob_requestedById_fkey"
            FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluationAudit_submissionId_fkey') THEN
        ALTER TABLE "AssignmentEvaluationAudit" ADD CONSTRAINT "AssignmentEvaluationAudit_submissionId_fkey"
            FOREIGN KEY ("submissionId") REFERENCES "AssignmentSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssignmentEvaluationAudit_actorId_fkey') THEN
        ALTER TABLE "AssignmentEvaluationAudit" ADD CONSTRAINT "AssignmentEvaluationAudit_actorId_fkey"
            FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;
