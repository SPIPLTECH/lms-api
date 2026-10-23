-- Multi-device sign-in: one ACTIVE session per (user, device) instead of one
-- per user.
--
-- Policy (2026-10-21): every role may be signed in on several devices.
-- Students are limited to ONE ACTIVE PLAYBACK LEASE per account (unchanged:
-- "PlaybackLease_one_active_per_user" stays), so a second device can sign in
-- but cannot start a protected video while another device is watching.
-- Admins and instructors have no login or playback limit.
--
-- Index-only change. No table, column or row is altered or deleted.
--  - drops "AuthSession_one_active_per_user"  (blocked a second device)
--  - creates "AuthSession_one_active_per_device" — each browser holds at most
--    one ACTIVE session, so a repeated sign-in on the same browser replaces
--    its own previous session atomically (the service ends the old one in the
--    same transaction; this index settles a race between two sign-ins from
--    the same browser).
--
-- Apply BEFORE (or together with) the backend build that allows multiple
-- devices. Until it is applied, that build still refuses a second device with
-- 409 SESSION_ALREADY_ACTIVE, because the old index rejects the insert.
--
-- npx prisma db execute --file scripts/auth-sessions-per-device.sql --schema prisma/schema.prisma
-- Rollback: scripts/rollback-auth-sessions-per-device.sql
-- Re-runnable.

BEGIN;

DROP INDEX IF EXISTS "AuthSession_one_active_per_user";

CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_one_active_per_device"
  ON "AuthSession" ("userId", "deviceId") WHERE "status" = 'ACTIVE';

COMMIT;
