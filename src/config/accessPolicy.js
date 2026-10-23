/**
 * Role policy for sign-in and protected playback (2026-10-21).
 *
 *  Sign-in    every role may be signed in on several devices at once
 *             (one ACTIVE session per device — AuthSession_one_active_per_device).
 *             A second device is never refused and never signs the first out.
 *
 *  Playback   STUDENT accounts may watch protected video on one device at a
 *             time: starting playback needs the account's single playback
 *             lease (PlaybackLease_one_active_per_user). A second device gets
 *             409 PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE until the first device's
 *             lease is released or expires.
 *             ADMIN and INSTRUCTOR are not limited: they author and review
 *             content, already receive video sources directly, and take no
 *             playback lease.
 *
 *  Content    While a STUDENT device holds that lease, the account's OTHER
 *             devices cannot read course content or act on it (course tree,
 *             modules/lessons/topics/subtopics/concepts/contents, learning
 *             sequence and path, quizzes, assignment details, progress and
 *             learning-state writes, AI assistant): 409
 *             CONTENT_ACTIVE_ON_ANOTHER_DEVICE from
 *             middleware/contentAccess.middleware.js. The frontend's Blob
 *             proxy refuses them file bytes the same way. The lease holder is
 *             unaffected; access returns when the lease is stopped or expires.
 */
const SINGLE_PLAYBACK_ROLES = new Set(["STUDENT"]);

/** Whether this role must hold the account's single playback lease to play. */
const requiresPlaybackLease = (role) => SINGLE_PLAYBACK_ROLES.has(role);

module.exports = {
  SINGLE_PLAYBACK_ROLES,
  requiresPlaybackLease,
};
