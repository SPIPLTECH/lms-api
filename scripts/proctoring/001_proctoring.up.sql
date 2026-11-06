-- Proctoring, merged into the LMS. Additive only: no existing column, row or index
-- is changed or removed. Every existing quiz reads as not proctored.
-- Rollback: scripts/proctoring/001_proctoring.down.sql
--
-- IMPORTANT: apply this BEFORE deploying code built from this schema. The Prisma
-- client selects the new Quiz columns on every quiz read.

BEGIN;

ALTER TABLE "Quiz"
  ADD COLUMN IF NOT EXISTS "proctoringEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "proctoringSetById" TEXT,
  ADD COLUMN IF NOT EXISTS "proctoringSetAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProctoredAttempt" (
  "id" TEXT NOT NULL,
  "quizId" TEXT NOT NULL,
  "courseId" TEXT NOT NULL,
  "studentId" TEXT,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PREPARING',
  "quizAttemptId" TEXT,
  "policy" JSONB NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "identityMatching" BOOLEAN NOT NULL DEFAULT true,
  "consentId" TEXT,
  "deviceId" TEXT,
  "tokenVersion" INTEGER NOT NULL DEFAULT 1,
  "identityCheck" TEXT NOT NULL DEFAULT 'PENDING',
  "identityNotes" TEXT,
  "identityFailures" INTEGER NOT NULL DEFAULT 0,
  "identityRecheckPending" BOOLEAN NOT NULL DEFAULT false,
  "microphoneStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "cameraSeenAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "deadlineAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "endReason" TEXT,
  "terminatedAt" TIMESTAMP(3),
  "terminationRule" TEXT,
  "terminationReason" TEXT,
  "warningCount" INTEGER NOT NULL DEFAULT 0,
  "isFlagged" BOOLEAN NOT NULL DEFAULT false,
  "flags" JSONB NOT NULL DEFAULT '[]',
  "framesReceived" INTEGER NOT NULL DEFAULT 0,
  "framesAnalysed" INTEGER NOT NULL DEFAULT 0,
  "framesSkipped" INTEGER NOT NULL DEFAULT 0,
  "lastHeartbeatAt" TIMESTAMP(3),
  "lastSnapshotAt" TIMESTAMP(3),
  "longestGapSeconds" INTEGER,
  "reviewState" TEXT NOT NULL DEFAULT 'NONE',
  "reviewReason" TEXT,
  "reviewRound" INTEGER NOT NULL DEFAULT 0,
  "reviewDueAt" TIMESTAMP(3),
  "reminderSentAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "decision" TEXT,
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProctoredAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProctoredAnswer" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "answer" JSONB,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "state" JSONB,
  "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProctoredAnswer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProctoringConsent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "quizId" TEXT NOT NULL,
  "attemptId" TEXT,
  "wordingVersion" TEXT NOT NULL,
  "wordingHash" TEXT NOT NULL,
  "identityMatching" BOOLEAN NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProctoringConsent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProctoringEvent" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'LOW',
  "warningIssued" BOOLEAN NOT NULL DEFAULT false,
  "seq" INTEGER,
  "clientTimestamp" TIMESTAMP(3),
  "metadata" JSONB,
  "serverTimestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProctoringEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProctoringEvidence" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "frameId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "storageState" TEXT NOT NULL DEFAULT 'LOCAL',
  "objectKey" TEXT,
  "tempPath" TEXT,
  "mimeType" TEXT NOT NULL DEFAULT 'image/jpeg',
  "fileSize" INTEGER NOT NULL DEFAULT 0,
  "analysis" JSONB,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientCapturedAt" TIMESTAMP(3),
  "late" BOOLEAN NOT NULL DEFAULT false,
  "retainUntil" TIMESTAMP(3),
  "reviewHold" BOOLEAN NOT NULL DEFAULT false,
  "copyAttempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProctoringEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProctoringIdentityBaseline" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "embedding" BYTEA NOT NULL,
  "modelName" TEXT NOT NULL,
  "modelSha256" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProctoringIdentityBaseline_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProctoringRetakeGrant" (
  "id" TEXT NOT NULL,
  "quizId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "sourceAttemptId" TEXT NOT NULL,
  "grantedById" TEXT NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProctoringRetakeGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProctoringReviewRequest" (
  "id" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "round" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "reminderSentAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProctoringReviewRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProctoredAttempt_quizAttemptId_key" ON "ProctoredAttempt" ("quizAttemptId");
CREATE INDEX IF NOT EXISTS "ProctoredAttempt_quizId_idx" ON "ProctoredAttempt" ("quizId");
CREATE INDEX IF NOT EXISTS "ProctoredAttempt_courseId_reviewState_idx" ON "ProctoredAttempt" ("courseId", "reviewState");
CREATE INDEX IF NOT EXISTS "ProctoredAttempt_studentId_status_idx" ON "ProctoredAttempt" ("studentId", "status");
CREATE INDEX IF NOT EXISTS "ProctoredAttempt_userId_status_idx" ON "ProctoredAttempt" ("userId", "status");
CREATE INDEX IF NOT EXISTS "ProctoredAttempt_status_deadlineAt_idx" ON "ProctoredAttempt" ("status", "deadlineAt");
CREATE INDEX IF NOT EXISTS "ProctoredAttempt_reviewState_reviewDueAt_idx" ON "ProctoredAttempt" ("reviewState", "reviewDueAt");
CREATE UNIQUE INDEX IF NOT EXISTS "ProctoredAnswer_attemptId_questionId_key" ON "ProctoredAnswer" ("attemptId", "questionId");
CREATE INDEX IF NOT EXISTS "ProctoringConsent_userId_quizId_idx" ON "ProctoringConsent" ("userId", "quizId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProctoringEvent_attemptId_seq_key" ON "ProctoringEvent" ("attemptId", "seq");
CREATE INDEX IF NOT EXISTS "ProctoringEvent_attemptId_serverTimestamp_idx" ON "ProctoringEvent" ("attemptId", "serverTimestamp");
CREATE UNIQUE INDEX IF NOT EXISTS "ProctoringEvidence_attemptId_frameId_key" ON "ProctoringEvidence" ("attemptId", "frameId");
CREATE INDEX IF NOT EXISTS "ProctoringEvidence_attemptId_receivedAt_idx" ON "ProctoringEvidence" ("attemptId", "receivedAt");
CREATE INDEX IF NOT EXISTS "ProctoringEvidence_retainUntil_reviewHold_idx" ON "ProctoringEvidence" ("retainUntil", "reviewHold");
CREATE INDEX IF NOT EXISTS "ProctoringEvidence_storageState_idx" ON "ProctoringEvidence" ("storageState");
CREATE UNIQUE INDEX IF NOT EXISTS "ProctoringIdentityBaseline_attemptId_key" ON "ProctoringIdentityBaseline" ("attemptId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProctoringRetakeGrant_sourceAttemptId_key" ON "ProctoringRetakeGrant" ("sourceAttemptId");
CREATE INDEX IF NOT EXISTS "ProctoringRetakeGrant_quizId_studentId_idx" ON "ProctoringRetakeGrant" ("quizId", "studentId");
CREATE UNIQUE INDEX IF NOT EXISTS "ProctoringReviewRequest_attemptId_round_key" ON "ProctoringReviewRequest" ("attemptId", "round");

-- Prisma cannot express this one: at most one open attempt per student and quiz.
CREATE UNIQUE INDEX IF NOT EXISTS "ProctoredAttempt_one_open_per_student"
  ON "ProctoredAttempt" ("quizId", "userId") WHERE "status" IN ('PREPARING', 'IN_PROGRESS');

-- A quiz with proctored attempts cannot be deleted through any path.
ALTER TABLE "ProctoredAttempt" ADD CONSTRAINT "ProctoredAttempt_quizId_fkey"
  FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProctoredAttempt" ADD CONSTRAINT "ProctoredAttempt_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProctoredAttempt" ADD CONSTRAINT "ProctoredAttempt_quizAttemptId_fkey"
  FOREIGN KEY ("quizAttemptId") REFERENCES "QuizAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProctoredAnswer" ADD CONSTRAINT "ProctoredAnswer_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ProctoredAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProctoringEvent" ADD CONSTRAINT "ProctoringEvent_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ProctoredAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProctoringEvidence" ADD CONSTRAINT "ProctoringEvidence_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ProctoredAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProctoringIdentityBaseline" ADD CONSTRAINT "ProctoringIdentityBaseline_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ProctoredAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProctoringRetakeGrant" ADD CONSTRAINT "ProctoringRetakeGrant_sourceAttemptId_fkey"
  FOREIGN KEY ("sourceAttemptId") REFERENCES "ProctoredAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProctoringReviewRequest" ADD CONSTRAINT "ProctoringReviewRequest_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "ProctoredAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
