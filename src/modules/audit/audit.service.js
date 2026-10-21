const prisma = require("../../config/database");

/**
 * Security audit trail (AuditEvent). Records who/what/why — never tokens,
 * IP addresses or email addresses.
 *
 * Two modes:
 *  - best effort (default): written after the action has committed; a failed
 *    write is logged and swallowed so auditing can never break sign-in or
 *    playback.
 *  - `{ client: tx }`: written inside the caller's transaction, so the action
 *    and its record commit or roll back together (admin revocation).
 */
const AUDIT_EVENTS = {
  LOGIN_SUCCEEDED: "LOGIN_SUCCEEDED",
  LOGIN_FAILED: "LOGIN_FAILED",
  SESSION_CONFLICT: "SESSION_CONFLICT",
  SESSION_ROTATED: "SESSION_ROTATED",
  LOGOUT: "LOGOUT",
  SESSION_REVOKED: "SESSION_REVOKED",
  IDENTITY_LINKED: "IDENTITY_LINKED",
  PLAYBACK_STARTED: "PLAYBACK_STARTED",
  PLAYBACK_CONFLICT: "PLAYBACK_CONFLICT",
  PLAYBACK_STOPPED: "PLAYBACK_STOPPED",
  PLAYBACK_LEASE_RECLAIMED: "PLAYBACK_LEASE_RECLAIMED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  PLAYBACK_LEASE_EXPIRED: "PLAYBACK_LEASE_EXPIRED",
};

const toRow = ({ userId = null, sessionId = null, deviceId = null, contentId = null, eventType, reasonCode = null, metadata = null }) => ({
  userId,
  sessionId,
  deviceId,
  contentId,
  eventType,
  reasonCode,
  metadata: metadata || undefined,
});

async function recordAuditEvent(event, { client = null } = {}) {
  if (client) {
    return client.auditEvent.create({ data: toRow(event) });
  }
  try {
    return await prisma.auditEvent.create({ data: toRow(event) });
  } catch (error) {
    console.warn("[audit] could not record", event.eventType, error?.message);
    return null;
  }
}

/**
 * Several events in one statement (expiries found in bulk). Same two modes as
 * recordAuditEvent: inside the caller's transaction with `client`, otherwise
 * best effort.
 */
async function recordAuditEvents(events, { client = null } = {}) {
  if (!events || events.length === 0) return null;
  const data = events.map(toRow);
  if (client) {
    return client.auditEvent.createMany({ data });
  }
  try {
    return await prisma.auditEvent.createMany({ data });
  } catch (error) {
    console.warn("[audit] could not record", events.length, "events:", error?.message);
    return null;
  }
}

module.exports = {
  AUDIT_EVENTS,
  recordAuditEvent,
  recordAuditEvents,
};
