const prisma = require("../../config/database");
const {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_TOUCH_INTERVAL_MS,
} = require("../../config/session");
const { randomToken, sha256, isWellFormedToken, digestsEqual } = require("../../utils/sessionCrypto");
const { authError } = require("../../utils/authErrors");
const ApiError = require("../../utils/ApiError");
const { AUDIT_EVENTS, recordAuditEvent, recordAuditEvents } = require("../audit/audit.service");

/**
 * Authenticated sessions, one per signed-in device.
 *
 * Authority lives in PostgreSQL:
 *  - AuthSession rows, one per sign-in; the refresh credential is an opaque
 *    random token of which only the SHA-256 is stored (`tokenHash`).
 *  - the partial unique index "AuthSession_one_active_per_device"
 *    (scripts/auth-sessions-per-device.sql) — at most one ACTIVE session per
 *    (user, device); it settles a race between two sign-ins from one browser.
 *  - Device rows, one per (user, server-issued browser key).
 *
 * Every protected request is checked against the row (validateAccess): it
 * must be ACTIVE, inside both its idle and absolute deadlines, presented
 * from the device it is bound to, and its user's account must be ACTIVE.
 * Access JWTs only carry the session id (`sid`) to find that row.
 *
 * Policy (config/accessPolicy.js, 2026-10-21) — the same for every role:
 *  - Signing in on another device is allowed and never ends an existing
 *    device's session. (Students are limited to one active *video* at a
 *    time; that is the playback lease's job, not sign-in's.)
 *  - The same device signing in again rotates its session in place when it
 *    proves possession of the current session (presents its refresh
 *    credential); otherwise its previous session on that device is ended in
 *    the same transaction and replaced — it is the same browser, and the old
 *    credential is already gone from it.
 *  - A browser whose storage was cleared is a new device.
 *  - Sessions end by logout, expiry, replacement on the same device, or an
 *    audited revocation (admin, account status, password reset, role change).
 */

const STATUS = { ACTIVE: "ACTIVE", LOGGED_OUT: "LOGGED_OUT", REVOKED: "REVOKED", EXPIRED: "EXPIRED" };

const END_REASONS = {
  LOGOUT: "LOGOUT",
  EXPIRED: "EXPIRED",
  ADMIN_REVOKE: "ADMIN_REVOKE",
  ACCOUNT_STATUS: "ACCOUNT_STATUS",
  PASSWORD_RESET: "PASSWORD_RESET",
  PASSWORD_CHANGED: "PASSWORD_CHANGED",
  ROLE_CHANGED: "ROLE_CHANGED",
  REPLACED_ON_DEVICE: "REPLACED_ON_DEVICE",
};

const AUTH_METHODS = { PASSWORD: "PASSWORD", GOOGLE: "GOOGLE" };

// Shown only while the database still has the old per-user session index.
const MULTI_DEVICE_NOT_ENABLED =
  "Signing in on more than one device is not enabled on this server yet. Please contact your administrator.";

const isUniqueViolation = (error) => error?.code === "P2002";

const idleDeadline = (now, absoluteExpiry) =>
  new Date(Math.min(now.getTime() + SESSION_IDLE_TIMEOUT_MS, new Date(absoluteExpiry).getTime()));

const isPastDeadline = (session, now) =>
  new Date(session.expiresAt) <= now || new Date(session.absoluteExpiry) <= now;

const deviceKeyHashOf = (deviceKey) => (isWellFormedToken(deviceKey) ? sha256(deviceKey) : null);

/** "Chrome on Windows"-style label, for an admin to recognise a device. */
function deviceLabelFrom(userAgent) {
  if (!userAgent) return null;
  const browser =
    /Edg\//.test(userAgent) ? "Edge"
      : /OPR\//.test(userAgent) ? "Opera"
        : /Chrome\//.test(userAgent) ? "Chrome"
          : /Firefox\//.test(userAgent) ? "Firefox"
            : /Safari\//.test(userAgent) ? "Safari"
              : "Browser";
  const os =
    /Android/.test(userAgent) ? "Android"
      : /iPhone|iPad|iPod/.test(userAgent) ? "iOS"
        : /Windows/.test(userAgent) ? "Windows"
          : /Mac OS X/.test(userAgent) ? "macOS"
            : /Linux/.test(userAgent) ? "Linux"
              : "unknown OS";
  return `${browser} on ${os}`;
}

const trimUserAgent = (userAgent) => (typeof userAgent === "string" ? userAgent.slice(0, 512) : null);

/** Closes sockets opened under the given sessions (best effort, this process only). */
function disconnectSessionSockets(sessionIds) {
  try {
    // Required lazily: the socket layer itself depends on this module.
    require("../../socket").disconnectSessions(sessionIds);
  } catch {
    // Socket.io not initialised (tests, scripts) — nothing to close.
  }
}

/**
 * Moves sessions matching `where` that are past a deadline out of ACTIVE,
 * and stops their playback leases with them. Returns the expired ids.
 */
async function expireStaleSessions(where, client = prisma, now = new Date()) {
  const stale = await client.authSession.findMany({
    where: {
      ...where,
      status: STATUS.ACTIVE,
      OR: [{ expiresAt: { lte: now } }, { absoluteExpiry: { lte: now } }],
    },
    select: { id: true, userId: true, deviceId: true },
  });
  if (stale.length === 0) return [];

  const ids = stale.map((row) => row.id);
  const ended = await client.authSession.updateMany({
    where: { id: { in: ids }, status: STATUS.ACTIVE },
    data: { status: STATUS.EXPIRED, endedAt: now, endReason: END_REASONS.EXPIRED },
  });
  const leases = await expireLeasesWhere(
    { sessionId: { in: ids }, status: "ACTIVE" },
    "SESSION_EXPIRED",
    client,
    now
  );

  // A concurrent request may have expired the same rows first; only the
  // call that moved them records it.
  if (ended.count > 0) {
    await recordAuditEvents(
      [
        ...stale.map((s) => ({ userId: s.userId, sessionId: s.id, deviceId: s.deviceId, eventType: AUDIT_EVENTS.SESSION_EXPIRED, reasonCode: END_REASONS.EXPIRED })),
        ...leases.map((l) => leaseExpiredEvent(l, "SESSION_EXPIRED")),
      ],
      { client: client === prisma ? null : client }
    );
  }
  return ids;
}

const leaseExpiredEvent = (lease, reason) => ({
  userId: lease.userId,
  sessionId: lease.sessionId,
  deviceId: lease.deviceId,
  contentId: lease.contentId,
  eventType: AUDIT_EVENTS.PLAYBACK_LEASE_EXPIRED,
  reasonCode: reason,
});

/**
 * Moves ACTIVE leases matching `where` to EXPIRED and returns the rows it
 * moved (for auditing). The update is conditional on ACTIVE, so a lease
 * stopped in between is never overwritten.
 */
async function expireLeasesWhere(where, reason, client = prisma, now = new Date()) {
  const rows = await client.playbackLease.findMany({
    where: { ...where, status: "ACTIVE" },
    select: { id: true, userId: true, sessionId: true, deviceId: true, contentId: true },
  });
  if (rows.length === 0) return [];
  const moved = await client.playbackLease.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, status: "ACTIVE" },
    data: { status: "EXPIRED", stoppedAt: now, stopReason: reason },
  });
  return moved.count > 0 ? rows : [];
}

/**
 * Ends ACTIVE sessions matching `where` with `status`/`reason`, and ends their
 * playback leases in the same statement batch. Returns the ended ids.
 */
async function endSessionsWhere(where, { status, reason, leaseStatus }, client, now = new Date()) {
  const active = await client.authSession.findMany({
    where: { ...where, status: STATUS.ACTIVE },
    select: { id: true },
  });
  if (active.length === 0) return [];

  const ids = active.map((row) => row.id);
  await client.authSession.updateMany({
    where: { id: { in: ids }, status: STATUS.ACTIVE },
    data: { status, endedAt: now, endReason: reason },
  });
  await client.playbackLease.updateMany({
    where: { sessionId: { in: ids }, status: "ACTIVE" },
    data: { status: leaseStatus, stoppedAt: now, stopReason: reason },
  });
  return ids;
}

/**
 * Creates this device's ACTIVE session, after the caller has fully
 * authenticated the user (password or verified Google identity) and checked
 * the account status. Other devices' sessions are never touched.
 *
 * Atomic: stale sessions are expired, this device's previous session (if
 * any) is rotated or replaced, and the new row is inserted in one
 * transaction. "AuthSession_one_active_per_device" settles a race between
 * two sign-ins from the same browser (the loser gets 409).
 *
 * @returns {{ session, refreshToken, deviceKey: string|null, rotated: boolean }}
 *   `deviceKey` is set only when a new device key was issued; the client must
 *   store it and send it back as X-Device-Key.
 */
async function createSession({ userId, authMethod, deviceKey, currentRefreshToken = null, userAgent = null }) {
  const now = new Date();
  const refreshToken = randomToken(48);
  const tokenHash = sha256(refreshToken);
  const presentedDeviceHash = deviceKeyHashOf(deviceKey);
  const presentedRefreshHash = isWellFormedToken(currentRefreshToken) ? sha256(currentRefreshToken) : null;
  const agent = trimUserAgent(userAgent);

  let issuedDeviceKey = null;
  let replacedSessionIds = [];

  const claim = () =>
    prisma.$transaction(async (tx) => {
      issuedDeviceKey = null;
      replacedSessionIds = [];
      await expireStaleSessions({ userId }, tx, now);

      let device = presentedDeviceHash
        ? await tx.device.findUnique({
          where: { userId_deviceKeyHash: { userId, deviceKeyHash: presentedDeviceHash } },
        })
        : null;
      if (device?.revokedAt) device = null;

      // Only THIS device's session matters: other devices may stay signed in.
      const activeHere = device
        ? await tx.authSession.findFirst({ where: { userId, deviceId: device.id, status: STATUS.ACTIVE } })
        : null;

      if (activeHere) {
        const provesPossession = Boolean(presentedRefreshHash) && digestsEqual(presentedRefreshHash, activeHere.tokenHash);
        if (provesPossession) {
          // Same device, proven: rotate the credential, keep the session.
          const session = await tx.authSession.update({
            where: { id: activeHere.id },
            data: {
              tokenHash,
              authMethod,
              lastSeenAt: now,
              expiresAt: idleDeadline(now, activeHere.absoluteExpiry),
            },
          });
          await tx.device.update({ where: { id: device.id }, data: { lastSeenAt: now, userAgent: agent } });
          return { session, rotated: true };
        }

        // Same browser without its credential (cleared, or lost after a
        // failure): end its previous session and lease, then sign in afresh.
        replacedSessionIds = await endSessionsWhere(
          { id: activeHere.id },
          { status: STATUS.REVOKED, reason: END_REASONS.REPLACED_ON_DEVICE, leaseStatus: "STOPPED" },
          tx,
          now
        );
      }

      if (device) {
        await tx.device.update({ where: { id: device.id }, data: { lastSeenAt: now, userAgent: agent } });
      } else {
        issuedDeviceKey = randomToken(32);
        device = await tx.device.create({
          data: {
            userId,
            deviceKeyHash: sha256(issuedDeviceKey),
            userAgent: agent,
            label: deviceLabelFrom(agent),
          },
        });
      }

      const absoluteExpiry = new Date(now.getTime() + SESSION_ABSOLUTE_LIFETIME_MS);
      const session = await tx.authSession.create({
        data: {
          userId,
          deviceId: device.id,
          tokenHash,
          authMethod,
          lastSeenAt: now,
          expiresAt: idleDeadline(now, absoluteExpiry),
          absoluteExpiry,
        },
      });
      return { session, rotated: false };
    });

  let result;
  try {
    result = await claim();
  } catch (error) {
    if (isUniqueViolation(error)) {
      // The old one-session-per-user index is still in the database
      // (scripts/auth-sessions-per-device.sql not applied): it refuses every
      // second device although this code allows it. Say so in the server log
      // and to the user, instead of telling them to sign out elsewhere.
      // Anything else (the per-device or device-key index) is a concurrent
      // sign-in from the SAME browser that committed first.
      const target = [].concat(error.meta?.target || []).join(",");
      const legacyIndex = target === "userId" || /AuthSession_one_active_per_user/.test(`${target} ${error.message || ""}`);
      if (legacyIndex) {
        console.error(
          "[session] Sign-in refused by the old AuthSession_one_active_per_user index. Multi-device sign-in needs " +
            "scripts/auth-sessions-per-device.sql applied to this database (npx prisma db execute --file " +
            "scripts/auth-sessions-per-device.sql --schema prisma/schema.prisma)."
        );
      }
      await recordAuditEvent({
        userId,
        eventType: AUDIT_EVENTS.SESSION_CONFLICT,
        reasonCode: legacyIndex ? "PER_DEVICE_INDEX_MISSING" : "CONCURRENT_SIGN_IN",
        metadata: { authMethod },
      });
      throw legacyIndex ? authError("SESSION_ALREADY_ACTIVE", MULTI_DEVICE_NOT_ENABLED) : authError("SESSION_ALREADY_ACTIVE");
    }
    throw error;
  }

  if (replacedSessionIds.length > 0) {
    await recordAuditEvent({
      userId,
      sessionId: replacedSessionIds[0],
      eventType: AUDIT_EVENTS.SESSION_REVOKED,
      reasonCode: END_REASONS.REPLACED_ON_DEVICE,
      metadata: { authMethod },
    });
    disconnectSessionSockets(replacedSessionIds);
  }

  await recordAuditEvent({
    userId,
    sessionId: result.session.id,
    deviceId: result.session.deviceId,
    eventType: result.rotated ? AUDIT_EVENTS.SESSION_ROTATED : AUDIT_EVENTS.LOGIN_SUCCEEDED,
    metadata: { authMethod },
  });

  return { session: result.session, refreshToken, deviceKey: issuedDeviceKey, rotated: result.rotated };
}

/**
 * The per-request gate. Resolves the session a token names and enforces
 * status, idle/absolute expiry, device binding and account status. Activity
 * pushes the idle deadline forward (written at most once a minute).
 *
 * Throws 401 SESSION_INVALID / SESSION_EXPIRED or 403 ACCOUNT_SUSPENDED.
 */
async function validateAccess({ sessionId, userId, deviceKey }) {
  if (!sessionId) throw authError("SESSION_INVALID");

  const session = await prisma.authSession.findUnique({
    where: { id: sessionId },
    include: {
      device: { select: { deviceKeyHash: true, revokedAt: true } },
      user: { select: { status: true } },
    },
  });

  return checkSession(session, { userId, deviceKey });
}

/** Shared by validateAccess and refreshSession. */
async function checkSession(session, { userId = null, deviceKey }) {
  const now = new Date();

  if (!session || (userId && session.userId !== userId)) throw authError("SESSION_INVALID");

  if (session.status !== STATUS.ACTIVE) {
    throw authError(session.status === STATUS.EXPIRED ? "SESSION_EXPIRED" : "SESSION_INVALID");
  }

  if (isPastDeadline(session, now)) {
    await expireStaleSessions({ id: session.id }, prisma, now);
    disconnectSessionSockets([session.id]);
    throw authError("SESSION_EXPIRED");
  }

  const presentedHash = deviceKeyHashOf(deviceKey);
  if (!presentedHash || session.device?.revokedAt || !digestsEqual(presentedHash, session.device?.deviceKeyHash)) {
    throw authError("SESSION_INVALID");
  }

  if (session.user?.status !== "ACTIVE") {
    await revokeUserSessions(session.userId, END_REASONS.ACCOUNT_STATUS);
    throw authError("ACCOUNT_SUSPENDED");
  }

  if (now - new Date(session.lastSeenAt) >= SESSION_TOUCH_INTERVAL_MS) {
    await touchSession(session, now);
  }

  return session;
}

async function touchSession(session, now = new Date()) {
  const expiresAt = idleDeadline(now, session.absoluteExpiry);
  try {
    // Conditional on ACTIVE, so a touch can never resurrect an ended session.
    // One write per minute per active session; the device's lastSeenAt is
    // kept by sign-in, not on every request.
    await prisma.authSession.updateMany({
      where: { id: session.id, status: STATUS.ACTIVE },
      data: { lastSeenAt: now, expiresAt },
    });
  } catch (error) {
    console.warn("[session] could not record activity:", error?.message);
  }
  session.lastSeenAt = now;
  session.expiresAt = expiresAt;
}

/**
 * Exchanges the opaque refresh credential (plus the device key it is bound
 * to) for the session and its user, enforcing the same rules as every
 * request — so a suspended account, an expired or revoked session, or a
 * credential replayed from another browser cannot mint access tokens.
 */
async function refreshSession({ refreshToken, deviceKey }) {
  if (!isWellFormedToken(refreshToken)) throw authError("SESSION_INVALID");

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: sha256(refreshToken) },
    include: {
      device: { select: { deviceKeyHash: true, revokedAt: true } },
      user: { select: { id: true, email: true, role: true, status: true } },
    },
  });

  // Refreshing is activity: always push the idle deadline forward.
  if (session) session.lastSeenAt = new Date(0);
  await checkSession(session, { deviceKey });
  return session;
}

/**
 * Logout: ends the caller's session and its playback lease in one
 * transaction. Idempotent — an already-ended or unknown session is a no-op.
 */
async function logout({ sessionId = null, refreshToken = null }) {
  let where = null;
  if (sessionId) where = { id: sessionId };
  else if (isWellFormedToken(refreshToken)) where = { tokenHash: sha256(refreshToken) };
  if (!where) return false;

  const ended = await prisma.$transaction((tx) =>
    endSessionsWhere(where, { status: STATUS.LOGGED_OUT, reason: END_REASONS.LOGOUT, leaseStatus: "STOPPED" }, tx)
  );
  if (ended.length === 0) return false;

  const session = await prisma.authSession.findUnique({ where: { id: ended[0] }, select: { userId: true, deviceId: true } });
  await recordAuditEvent({ userId: session?.userId, sessionId: ended[0], deviceId: session?.deviceId, eventType: AUDIT_EVENTS.LOGOUT });
  disconnectSessionSockets(ended);
  return true;
}

/**
 * Revokes every ACTIVE session of a user (account suspended/blocked/inactive).
 * Pass `client` to run inside the caller's transaction; sockets are then the
 * caller's to close via disconnectSessionSockets once it commits.
 */
async function revokeUserSessions(userId, reason = END_REASONS.ACCOUNT_STATUS, client = null) {
  const run = (tx) => endSessionsWhere({ userId }, { status: STATUS.REVOKED, reason, leaseStatus: "REVOKED" }, tx);
  const ended = client ? await run(client) : await prisma.$transaction(run);
  if (!client && ended.length > 0) {
    await recordAuditEvent({ userId, eventType: AUDIT_EVENTS.SESSION_REVOKED, reasonCode: reason, metadata: { sessions: ended.length } });
    disconnectSessionSockets(ended);
  }
  return ended;
}

/**
 * Revokes every ACTIVE session of a user except `keepSessionId` (the caller's
 * own), with its playback lease — used when the password is changed while
 * signed in: the other devices are signed out, this one stays.
 */
async function revokeOtherSessions(userId, keepSessionId, reason = END_REASONS.PASSWORD_CHANGED) {
  const where = keepSessionId ? { userId, id: { not: keepSessionId } } : { userId };
  const ended = await prisma.$transaction((tx) =>
    endSessionsWhere(where, { status: STATUS.REVOKED, reason, leaseStatus: "REVOKED" }, tx)
  );
  if (ended.length > 0) {
    await recordAuditEvent({ userId, sessionId: keepSessionId, eventType: AUDIT_EVENTS.SESSION_REVOKED, reasonCode: reason, metadata: { sessions: ended.length } });
    disconnectSessionSockets(ended);
  }
  return ended;
}

/**
 * Audited administrative revocation of one session (ADMIN only — enforced by
 * the route). The revocation and its audit record commit together.
 */
async function adminRevokeSession(sessionId, adminUserId) {
  const session = await prisma.authSession.findUnique({ where: { id: sessionId }, select: { id: true, userId: true, deviceId: true } });
  if (!session) throw new ApiError(404, "Session not found", "NOT_FOUND");

  const ended = await prisma.$transaction(async (tx) => {
    const ids = await endSessionsWhere(
      { id: sessionId },
      { status: STATUS.REVOKED, reason: END_REASONS.ADMIN_REVOKE, leaseStatus: "REVOKED" },
      tx
    );
    if (ids.length > 0) {
      await recordAuditEvent(
        {
          userId: session.userId,
          sessionId,
          deviceId: session.deviceId,
          eventType: AUDIT_EVENTS.SESSION_REVOKED,
          reasonCode: END_REASONS.ADMIN_REVOKE,
          metadata: { revokedBy: adminUserId },
        },
        { client: tx }
      );
    }
    return ids;
  });

  disconnectSessionSockets(ended);
  return { revoked: ended.length > 0 };
}

const toSessionDto = (session) => ({
  id: session.id,
  status: session.status,
  authMethod: session.authMethod,
  createdAt: session.createdAt,
  lastSeenAt: session.lastSeenAt,
  expiresAt: session.expiresAt,
  absoluteExpiry: session.absoluteExpiry,
  endedAt: session.endedAt ?? null,
  endReason: session.endReason ?? null,
});

const toDeviceDto = (device) =>
  device
    ? { id: device.id, label: device.label, firstSeenAt: device.firstSeenAt, lastSeenAt: device.lastSeenAt }
    : null;

/** GET /sessions/me — the caller's own session and device. */
async function getCurrentSession(sessionId) {
  const session = await prisma.authSession.findUnique({ where: { id: sessionId }, include: { device: true } });
  if (!session) throw authError("SESSION_INVALID");
  return { session: toSessionDto(session), device: toDeviceDto(session.device) };
}

/**
 * Admin view: every ACTIVE session (one per signed-in device), then the most
 * recent ended ones (no credentials, no IPs).
 */
async function listUserSessions(userId, { limit = 10 } = {}) {
  await expireStaleSessions({ userId });
  const [active, ended] = await Promise.all([
    prisma.authSession.findMany({
      where: { userId, status: STATUS.ACTIVE },
      orderBy: { createdAt: "desc" },
      include: { device: true },
    }),
    prisma.authSession.findMany({
      where: { userId, status: { not: STATUS.ACTIVE } },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { device: true },
    }),
  ]);
  return [...active, ...ended].map((session) => ({ ...toSessionDto(session), device: toDeviceDto(session.device) }));
}

/** Expires every stale session and lease (scheduled cleanup; also safe to call ad hoc). */
async function expireAllStale(now = new Date()) {
  const sessionIds = await prisma.$transaction((tx) => expireStaleSessions({}, tx, now));
  const leases = await prisma.$transaction(async (tx) => {
    const rows = await expireLeasesWhere({ expiresAt: { lte: now } }, "HEARTBEAT_TIMEOUT", tx, now);
    await recordAuditEvents(rows.map((l) => leaseExpiredEvent(l, "HEARTBEAT_TIMEOUT")), { client: tx });
    return rows;
  });
  disconnectSessionSockets(sessionIds);
  return { sessions: sessionIds.length, leases: leases.length };
}

module.exports = {
  STATUS,
  END_REASONS,
  AUTH_METHODS,
  createSession,
  validateAccess,
  refreshSession,
  logout,
  revokeUserSessions,
  revokeOtherSessions,
  adminRevokeSession,
  getCurrentSession,
  listUserSessions,
  expireAllStale,
  expireStaleSessions,
  expireLeasesWhere,
  leaseExpiredEvent,
  disconnectSessionSockets,
  deviceLabelFrom,
  toDeviceDto,
};
