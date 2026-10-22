-- Evaluator / guest-tester access (src/modules/evaluators).
--
-- Additive only: one new table, no change to any existing table. Generated
-- with `prisma migrate diff --from-schema-datasource --to-schema-datamodel`
-- and made idempotent, so running it twice is harmless.
--
-- Apply (do not use `prisma db push` on the shared database):
--   npx prisma db execute --file scripts/evaluator-access-schema.sql --schema prisma/schema.prisma
--
-- Remove the feature later:
--   DROP TABLE IF EXISTS "EvaluatorAccess";
--
-- Note: a branch whose schema.prisma lacks the EvaluatorAccess model will DROP
-- this table if someone runs `prisma db push` from it.

CREATE TABLE IF NOT EXISTS "EvaluatorAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "feedbackCompletedAt" TIMESTAMP(3),
    "feedbackSubmissionId" TEXT,
    "feedbackVerifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvaluatorAccess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "EvaluatorAccess_userId_key" ON "EvaluatorAccess"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "EvaluatorAccess_feedbackSubmissionId_key" ON "EvaluatorAccess"("feedbackSubmissionId");

CREATE INDEX IF NOT EXISTS "EvaluatorAccess_expiresAt_idx" ON "EvaluatorAccess"("expiresAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'EvaluatorAccess_userId_fkey'
  ) THEN
    ALTER TABLE "EvaluatorAccess"
      ADD CONSTRAINT "EvaluatorAccess_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
