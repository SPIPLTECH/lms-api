-- Rollback for scripts/auth-sessions-per-device.sql: back to one ACTIVE
-- session per user.
--
-- Deploy the previous backend build first.
--
-- The old index cannot be created while any user has more than one ACTIVE
-- session, so this script first ENDS every ACTIVE session except each user's
-- most recently created one (and stops those sessions' playback leases).
-- That is a data change: the affected devices are signed out. Review the
-- SELECT below on the target database before running the rest.
--
--   SELECT "userId", count(*) FROM "AuthSession" WHERE status = 'ACTIVE'
--   GROUP BY 1 HAVING count(*) > 1;
--
-- npx prisma db execute --file scripts/rollback-auth-sessions-per-device.sql --schema prisma/schema.prisma

BEGIN;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) AS rn
  FROM "AuthSession" WHERE status = 'ACTIVE'
), extra AS (
  SELECT id FROM ranked WHERE rn > 1
)
UPDATE "PlaybackLease"
   SET status = 'STOPPED', "stoppedAt" = now(), "stopReason" = 'ROLLBACK_SINGLE_SESSION'
 WHERE status = 'ACTIVE' AND "sessionId" IN (SELECT id FROM extra);

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) AS rn
  FROM "AuthSession" WHERE status = 'ACTIVE'
)
UPDATE "AuthSession"
   SET status = 'REVOKED', "endedAt" = now(), "endReason" = 'ROLLBACK_SINGLE_SESSION'
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

DROP INDEX IF EXISTS "AuthSession_one_active_per_device";

CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_one_active_per_user"
  ON "AuthSession" ("userId") WHERE "status" = 'ACTIVE';

COMMIT;
