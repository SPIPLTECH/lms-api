-- Rollback of 002_proctoring_opt_out.up.sql.
--
-- Removes every student's "without proctoring" choice: those students are then asked
-- again, and the quiz is proctored for them unless they opt out again. Their past
-- quiz attempts are kept. Deploy code from before this change FIRST: newer code reads
-- this table.

BEGIN;

DROP TABLE IF EXISTS "ProctoringOptOut";

COMMIT;
