-- Rollback of 001_proctoring.up.sql.
--
-- DESTRUCTIVE FOR PROCTORING DATA ONLY: removes the proctoring tables and the three
-- Quiz columns, and with them all proctored attempts, saved answers, consents and
-- evidence records. Back up first. It does not touch any other table or row. Evidence
-- files in the storage bucket are not removed by this script.
--
-- Deploy code from before the proctoring work FIRST: code built from the new schema
-- selects the Quiz columns this removes.

BEGIN;

DROP TABLE IF EXISTS "ProctoringReviewRequest";
DROP TABLE IF EXISTS "ProctoringRetakeGrant";
DROP TABLE IF EXISTS "ProctoringIdentityBaseline";
DROP TABLE IF EXISTS "ProctoringEvidence";
DROP TABLE IF EXISTS "ProctoringEvent";
DROP TABLE IF EXISTS "ProctoringConsent";
DROP TABLE IF EXISTS "ProctoredAnswer";
DROP TABLE IF EXISTS "ProctoredAttempt";

ALTER TABLE "Quiz"
  DROP COLUMN IF EXISTS "proctoringEnabled",
  DROP COLUMN IF EXISTS "proctoringSetById",
  DROP COLUMN IF EXISTS "proctoringSetAt";

COMMIT;
