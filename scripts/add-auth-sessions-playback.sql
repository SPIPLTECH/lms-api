-- Sign-in identities, single active session, device binding, single active
-- playback lease and the security audit trail.
--
-- Purely additive: five new tables, two new enums, their indexes and foreign
-- keys. No existing table, column or row is altered. The table/index/FK
-- definitions are exactly what `prisma migrate diff` produces for the models
-- in prisma/schema.prisma, so the Prisma client and this database agree.
--
-- On top of that, the two invariants Prisma cannot express — at most one
-- ACTIVE AuthSession and at most one ACTIVE PlaybackLease per user — are
-- PostgreSQL partial unique indexes. They are the final guard against two
-- concurrent sign-ins / playback starts both succeeding; the services move
-- expired rows out of ACTIVE inside the same transaction before claiming.
-- (An index predicate cannot say "expiresAt > now()" — now() is not
-- immutable — so expiry is the service's job, not the index's.)
--
-- Applied via `npx prisma db execute --file scripts/add-auth-sessions-playback.sql`,
-- never `db push`/`migrate dev`, per this project's DB-safety practice.
-- Re-runnable: every statement is guarded. Rollback:
-- scripts/rollback-auth-sessions-playback.sql.
--
-- Deploying the code that reads these tables logs every user out once:
-- tokens issued before it carry no session id and are refused.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "AuthSessionStatus" AS ENUM ('ACTIVE', 'LOGGED_OUT', 'REVOKED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "PlaybackLeaseStatus" AS ENUM ('ACTIVE', 'STOPPED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "UserIdentity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "issuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceKeyHash" TEXT NOT NULL,
    "label" TEXT,
    "userAgent" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "authMethod" TEXT NOT NULL,
    "status" "AuthSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiry" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PlaybackLease" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "status" "PlaybackLeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "stoppedAt" TIMESTAMP(3),
    "stopReason" TEXT,

    CONSTRAINT "PlaybackLease_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "deviceId" TEXT,
    "contentId" TEXT,
    "eventType" TEXT NOT NULL,
    "reasonCode" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserIdentity_issuer_subject_key" ON "UserIdentity"("issuer", "subject");
CREATE UNIQUE INDEX IF NOT EXISTS "UserIdentity_userId_provider_key" ON "UserIdentity"("userId", "provider");
CREATE INDEX IF NOT EXISTS "Device_userId_revokedAt_idx" ON "Device"("userId", "revokedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "Device_userId_deviceKeyHash_key" ON "Device"("userId", "deviceKeyHash");
CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX IF NOT EXISTS "AuthSession_userId_status_expiresAt_idx" ON "AuthSession"("userId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "AuthSession_deviceId_status_idx" ON "AuthSession"("deviceId", "status");
CREATE INDEX IF NOT EXISTS "PlaybackLease_userId_status_expiresAt_idx" ON "PlaybackLease"("userId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "PlaybackLease_sessionId_status_idx" ON "PlaybackLease"("sessionId", "status");
CREATE INDEX IF NOT EXISTS "PlaybackLease_contentId_idx" ON "PlaybackLease"("contentId");
CREATE INDEX IF NOT EXISTS "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "AuditEvent_eventType_createdAt_idx" ON "AuditEvent"("eventType", "createdAt");

-- The single-active invariants.
CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_one_active_per_user"
  ON "AuthSession" ("userId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS "PlaybackLease_one_active_per_user"
  ON "PlaybackLease" ("userId") WHERE "status" = 'ACTIVE';

DO $$ BEGIN
  ALTER TABLE "UserIdentity" ADD CONSTRAINT "UserIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlaybackLease" ADD CONSTRAINT "PlaybackLease_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlaybackLease" ADD CONSTRAINT "PlaybackLease_sessionId_fkey"
    FOREIGN KEY ("sessionId") REFERENCES "AuthSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlaybackLease" ADD CONSTRAINT "PlaybackLease_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "PlaybackLease" ADD CONSTRAINT "PlaybackLease_contentId_fkey"
    FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMIT;
