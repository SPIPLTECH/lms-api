-- Rollback for scripts/add-auth-sessions-playback.sql.
--
-- Drops ONLY the objects that script created. No pre-existing table, column
-- or row is touched. What is lost: Google identity links, devices, session
-- history, playback leases and the security audit trail — all data that did
-- not exist before the feature.
--
-- Deploy the previous backend build BEFORE running this: the new code reads
-- these tables on every authenticated request and fails without them.
--
-- npx prisma db execute --file scripts/rollback-auth-sessions-playback.sql

BEGIN;

DROP TABLE IF EXISTS "PlaybackLease";
DROP TABLE IF EXISTS "AuthSession";
DROP TABLE IF EXISTS "Device";
DROP TABLE IF EXISTS "UserIdentity";
DROP TABLE IF EXISTS "AuditEvent";

DROP TYPE IF EXISTS "PlaybackLeaseStatus";
DROP TYPE IF EXISTS "AuthSessionStatus";

COMMIT;
