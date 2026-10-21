const prisma = require("../../config/database");
const {
  PLAYBACK_HEARTBEAT_SECONDS,
  PLAYBACK_LEASE_TTL_SECONDS,
  MEDIA_URL_MAX_AGE_SECONDS,
} = require("../../config/session");
const { authError } = require("../../utils/authErrors");
const { COURSE_ID_INCLUDE, resolveCourseId } = require("../../utils/helpers/courseBreadcrumb.helper");
const progressService = require("../progress/progress.service");
const { AUDIT_EVENTS, recordAuditEvent, recordAuditEvents } = require("../audit/audit.service");
const { expireLeasesWhere, leaseExpiredEvent } = require("../sessions/session.service");
const { requiresPlaybackLease } = require("../../config/accessPolicy");
const { verifyMediaToken } = require("./mediaToken");
const { sourceOf, classifySource, buildMediaDescriptor, sendLocalFile, streamBlob } = require("./playbackMedia");

/**
 * The single active playback lease per STUDENT account. Students may be
 * signed in on several devices; only one of them can play protected video at
 * a time. ADMIN and INSTRUCTOR take no lease (config/accessPolicy.js).
 *
 * A lease is held by one (session, device). It is claimed in one transaction
 * that first moves stale leases out of ACTIVE (heartbeat timed out, or their
 * session ended); the partial unique index "PlaybackLease_one_active_per_user"
 * settles two simultaneous starts. Heartbeats renew it and can never revive a
 * lease that is no longer ACTIVE. Correctness never depends on the client's
 * stop call — a vanished player's lease simply expires.
 *
 * Content switching (decided): when the session that holds the lease starts
 * a different item, the lease's contentId is updated in place — never a
 * second ACTIVE row.
 */

const ACTIVE = "ACTIVE";
const LEASE_TTL_MS = PLAYBACK_LEASE_TTL_SECONDS * 1000;

const STOP_REASONS = new Set(["USER_STOPPED", "NAVIGATED_AWAY", "PAGE_HIDDEN", "CONTENT_CHANGED", "ENDED"]);

const isUniqueViolation = (error) => error?.code === "P2002";

const leaseExpiry = (now) => new Date(now.getTime() + LEASE_TTL_MS);

/**
 * Whether `user` may play `content`. Students: enrolled, and the item is not
 * locked by the learning sequence. Instructors: own the course. Admins: yes.
 */
async function assertMayPlay(user, content) {
  const courseId = resolveCourseId(content);
  if (!courseId) throw authError("CONTENT_ACCESS_DENIED");

  try {
    if (user.role === "STUDENT") {
      const profile = await prisma.studentProfile.findUnique({ where: { userId: user.id }, select: { id: true } });
      if (!profile) throw authError("CONTENT_ACCESS_DENIED");
      await progressService.assertCourseProgressAccess(user, profile.id, courseId);
      await progressService.assertContentsAccessible(profile.id, courseId, [content.id]);
    } else {
      await progressService.assertCourseProgressAccess(user, null, courseId);
    }
  } catch (error) {
    if (error?.code === "CONTENT_ACCESS_DENIED") throw error;
    // The access helpers throw plain 403/404 errors with useful messages
    // ("Finish … before opening this item."); keep the message, give the code.
    if (error?.statusCode === 403 || error?.statusCode === 404) {
      throw authError("CONTENT_ACCESS_DENIED", error.message);
    }
    throw error;
  }
}

/** Moves the user's stale ACTIVE leases out of ACTIVE. Returns how many. */
async function expireStaleLeases(userId, client, now) {
  const timedOut = await expireLeasesWhere({ userId, expiresAt: { lte: now } }, "HEARTBEAT_TIMEOUT", client, now);
  const orphaned = await expireLeasesWhere(
    { userId, session: { status: { not: "ACTIVE" } } },
    "SESSION_ENDED",
    client,
    now
  );
  await recordAuditEvents(
    [
      ...timedOut.map((lease) => leaseExpiredEvent(lease, "HEARTBEAT_TIMEOUT")),
      ...orphaned.map((lease) => leaseExpiredEvent(lease, "SESSION_ENDED")),
    ],
    { client }
  );
  return timedOut.length + orphaned.length;
}

/** One claim attempt: the transaction itself. */
const claimOnce = ({ userId, sessionId, deviceId, contentId }, now) =>
  prisma.$transaction(async (tx) => {
    const reclaimed = await expireStaleLeases(userId, tx, now);

    const current = await tx.playbackLease.findFirst({ where: { userId, status: ACTIVE } });
    if (current) {
      if (current.sessionId === sessionId && current.deviceId === deviceId) {
        const lease = await tx.playbackLease.update({
          where: { id: current.id },
          data: { contentId, lastHeartbeat: now, expiresAt: leaseExpiry(now) },
        });
        return { lease, reclaimed, switched: current.contentId !== contentId };
      }
      throw authError("PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
    }

    const lease = await tx.playbackLease.create({
      data: { userId, sessionId, deviceId, contentId, lastHeartbeat: now, expiresAt: leaseExpiry(now) },
    });
    return { lease, reclaimed, switched: false };
  });

/**
 * POST /playback/start. Checks access, claims the lease, and only then
 * issues the media descriptor.
 */
async function startPlayback(user, contentId) {
  const content = await prisma.content.findUnique({ where: { id: contentId }, include: COURSE_ID_INCLUDE });
  if (!content) throw authError("MEDIA_UNAVAILABLE", "Content not found.");
  if (content.type !== "VIDEO") throw authError("CONTENT_NOT_PLAYABLE");
  if (!sourceOf(content)) throw authError("MEDIA_UNAVAILABLE");

  await assertMayPlay(user, content);

  // ADMIN and INSTRUCTOR are not limited to one active video (accessPolicy):
  // no lease, and the source they already see in content responses.
  if (!requiresPlaybackLease(user.role)) {
    return {
      leaseId: null,
      contentId,
      expiresAt: null,
      heartbeatIntervalSeconds: null,
      leaseRequired: false,
      media: directMediaDescriptor(content),
    };
  }

  const claim = { userId: user.id, sessionId: user.sessionId, deviceId: user.deviceId, contentId };
  const audit = { userId: user.id, sessionId: user.sessionId, deviceId: user.deviceId, contentId };

  let result;
  for (let attempt = 0; ; attempt += 1) {
    try {
      result = await claimOnce(claim, new Date());
      break;
    } catch (error) {
      // A concurrent start committed first. Retry once: if it was this same
      // session, the retry finds and reuses that lease; otherwise it 409s.
      if (isUniqueViolation(error) && attempt === 0) continue;
      if (isUniqueViolation(error) || error?.code === "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE") {
        await recordAuditEvent({ ...audit, eventType: AUDIT_EVENTS.PLAYBACK_CONFLICT, reasonCode: isUniqueViolation(error) ? "CONCURRENT_START" : "ACTIVE_ELSEWHERE" });
        throw authError("PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
      }
      throw error;
    }
  }

  if (result.reclaimed > 0) {
    await recordAuditEvent({ ...audit, eventType: AUDIT_EVENTS.PLAYBACK_LEASE_RECLAIMED, metadata: { count: result.reclaimed } });
  }
  await recordAuditEvent({ ...audit, eventType: AUDIT_EVENTS.PLAYBACK_STARTED, metadata: result.switched ? { switched: true } : undefined });

  const media = buildMediaDescriptor(content, result.lease, { maxAgeSeconds: MEDIA_URL_MAX_AGE_SECONDS });

  return {
    leaseId: result.lease.id,
    contentId,
    expiresAt: result.lease.expiresAt,
    heartbeatIntervalSeconds: PLAYBACK_HEARTBEAT_SECONDS,
    leaseRequired: true,
    media,
  };
}

/** The stored source as-is, for roles that take no lease (staff). */
function directMediaDescriptor(content) {
  const source = classifySource(sourceOf(content));
  if (source.kind === "none") return null;
  const kind = source.kind === "local" || source.kind === "blob" ? "file" : source.kind;
  return { kind, url: source.url, protected: false };
}

const ownsLease = (lease, user) =>
  Boolean(lease) && lease.userId === user.id && lease.sessionId === user.sessionId && lease.deviceId === user.deviceId;

/**
 * Whether another session/device of this account holds the live playback
 * lease right now (STUDENT content-access rule; middleware/contentAccess).
 * Read-only: an expired lease, or one whose session has ended, does not
 * count — no cleanup write is needed to answer. One indexed query.
 */
async function isPlaybackHeldElsewhere(user, now = new Date()) {
  if (!requiresPlaybackLease(user?.role)) return false;
  const lease = await prisma.playbackLease.findFirst({
    where: { userId: user.id, status: ACTIVE, expiresAt: { gt: now }, session: { status: "ACTIVE" } },
    select: { userId: true, sessionId: true, deviceId: true },
  });
  return Boolean(lease) && !ownsLease(lease, user);
}

/**
 * POST /playback/heartbeat. Renews only an ACTIVE, unexpired lease owned by
 * this user, session and device; the renewal is a conditional update, so a
 * lease stopped/expired/revoked in between is never resurrected.
 */
async function heartbeat(user, leaseId) {
  // Roles without a playback lease have nothing to renew.
  if (!requiresPlaybackLease(user.role)) return;
  const now = new Date();
  const lease = await prisma.playbackLease.findUnique({ where: { id: leaseId } });

  if (!ownsLease(lease, user) || lease.status !== ACTIVE) throw authError("PLAYBACK_LEASE_LOST");

  if (new Date(lease.expiresAt) <= now) {
    const expired = await expireLeasesWhere({ id: leaseId }, "HEARTBEAT_TIMEOUT", prisma, now);
    await recordAuditEvents(expired.map((row) => leaseExpiredEvent(row, "HEARTBEAT_TIMEOUT")));
    throw authError("PLAYBACK_LEASE_LOST");
  }

  const { count } = await prisma.playbackLease.updateMany({
    where: { id: leaseId, status: ACTIVE, expiresAt: { gt: now }, sessionId: user.sessionId, deviceId: user.deviceId },
    data: { lastHeartbeat: now, expiresAt: leaseExpiry(now) },
  });
  if (count === 0) throw authError("PLAYBACK_LEASE_LOST");
}

/**
 * POST /playback/stop. Idempotent: stopping a lease that is already ended,
 * unknown, or not this caller's is a silent no-op (and reveals nothing).
 * With `contentId`, only stops the lease if it is still on that item — so a
 * tab closing an old video does not stop the video another tab of the same
 * browser has since switched the lease to.
 */
async function stopPlayback(user, { leaseId, contentId = null, reason = null }) {
  // Roles without a playback lease have nothing to release.
  if (!requiresPlaybackLease(user.role)) return false;
  const lease = await prisma.playbackLease.findUnique({ where: { id: leaseId } });
  if (!ownsLease(lease, user) || lease.status !== ACTIVE) return false;
  if (contentId && lease.contentId !== contentId) return false;

  const stopReason = STOP_REASONS.has(reason) ? reason : "USER_STOPPED";
  const { count } = await prisma.playbackLease.updateMany({
    where: { id: leaseId, status: ACTIVE },
    data: { status: "STOPPED", stoppedAt: new Date(), stopReason },
  });
  if (count > 0) {
    await recordAuditEvent({
      userId: user.id,
      sessionId: user.sessionId,
      deviceId: user.deviceId,
      contentId: lease.contentId,
      eventType: AUDIT_EVENTS.PLAYBACK_STOPPED,
      reasonCode: stopReason,
    });
  }
  return count > 0;
}

/**
 * GET /playback/status. Whether this account is playing anywhere, and the
 * lease details only if it is this device's own. Nothing about another
 * device is disclosed.
 */
async function getStatus(user) {
  if (!requiresPlaybackLease(user.role)) {
    return { active: false, heldByThisDevice: false, leaseRequired: false, heartbeatIntervalSeconds: null };
  }
  const now = new Date();
  await prisma.$transaction((tx) => expireStaleLeases(user.id, tx, now));
  const lease = await prisma.playbackLease.findFirst({ where: { userId: user.id, status: ACTIVE } });

  if (!lease) return { active: false, heldByThisDevice: false, heartbeatIntervalSeconds: PLAYBACK_HEARTBEAT_SECONDS };
  if (!ownsLease(lease, user)) return { active: true, heldByThisDevice: false, heartbeatIntervalSeconds: PLAYBACK_HEARTBEAT_SECONDS };
  return {
    active: true,
    heldByThisDevice: true,
    leaseId: lease.id,
    contentId: lease.contentId,
    expiresAt: lease.expiresAt,
    heartbeatIntervalSeconds: PLAYBACK_HEARTBEAT_SECONDS,
  };
}

/**
 * Authorizes a signed media URL: signature and expiry, then a live lease
 * whose session is still ACTIVE and whose content is the token's. Returns
 * the classified source to serve.
 */
async function authorizeMedia(token) {
  const claims = verifyMediaToken(token);
  if (!claims) throw authError("MEDIA_URL_INVALID");

  const now = new Date();
  const lease = await prisma.playbackLease.findUnique({
    where: { id: claims.leaseId },
    include: {
      session: { select: { status: true, expiresAt: true, absoluteExpiry: true } },
      content: { select: { id: true, type: true, videoUrl: true, fileUrl: true, externalUrl: true } },
    },
  });

  const leaseLive =
    lease &&
    lease.status === ACTIVE &&
    new Date(lease.expiresAt) > now &&
    lease.session?.status === "ACTIVE" &&
    new Date(lease.session.expiresAt) > now &&
    new Date(lease.session.absoluteExpiry) > now;
  if (!leaseLive) throw authError("PLAYBACK_LEASE_LOST");

  // Same-browser tabs may switch the lease to another item; the token stays
  // valid only for the item it was issued for, and only if that item is the
  // one the lease is on or was issued under this lease.
  const content =
    lease.content?.id === claims.contentId
      ? lease.content
      : await prisma.content.findUnique({
        where: { id: claims.contentId },
        select: { id: true, type: true, videoUrl: true, fileUrl: true, externalUrl: true },
      });
  if (!content || content.type !== "VIDEO") throw authError("MEDIA_UNAVAILABLE");

  const source = classifySource(sourceOf(content));
  if (source.kind !== "local" && source.kind !== "blob") throw authError("MEDIA_UNAVAILABLE");
  return source;
}

/** GET /playback/media/:token — serves the bytes for an authorized token. */
async function serveMedia(req, res, token) {
  const source = await authorizeMedia(token);
  if (source.kind === "local") return sendLocalFile(res, source.filePath);
  return streamBlob(req, res, source);
}

module.exports = {
  startPlayback,
  heartbeat,
  stopPlayback,
  getStatus,
  isPlaybackHeldElsewhere,
  authorizeMedia,
  serveMedia,
  STOP_REASONS,
};
