/**
 * Session, device and playback-lease timing. Read once at startup.
 *
 * Defaults are the technical specification's starting values (section 5):
 * 30 min idle timeout pushed forward by activity, 7 day absolute lifetime,
 * a 20 s playback heartbeat and a 60 s lease TTL. They are configuration, not
 * guarantees — tune them after measuring real network/player behaviour.
 */

const positiveNumber = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const SESSION_IDLE_TIMEOUT_MS = positiveNumber("SESSION_IDLE_TIMEOUT_MINUTES", 7 * 24 * 60) * 60 * 1000;
const SESSION_ABSOLUTE_LIFETIME_MS = positiveNumber("SESSION_ABSOLUTE_LIFETIME_HOURS", 7 * 24) * 60 * 60 * 1000;

// How stale `lastSeenAt` may get before a request writes it again. Without
// this every authenticated request would also be a write.
const SESSION_TOUCH_INTERVAL_MS = 60 * 1000;

const PLAYBACK_HEARTBEAT_SECONDS = positiveNumber("PLAYBACK_HEARTBEAT_SECONDS", 20);
const PLAYBACK_LEASE_TTL_SECONDS = Math.max(
  positiveNumber("PLAYBACK_LEASE_TTL_SECONDS", 60),
  PLAYBACK_HEARTBEAT_SECONDS * 2
);

// Upper bound on a signed media URL. The URL is only honoured while its
// lease is ACTIVE, so in practice it dies within one lease TTL of the owner
// stopping; this cap only matters for a lease that stays alive all day.
const MEDIA_URL_MAX_AGE_SECONDS = positiveNumber("MEDIA_URL_MAX_AGE_SECONDS", 6 * 60 * 60);

module.exports = {
  SESSION_IDLE_TIMEOUT_MS,
  SESSION_ABSOLUTE_LIFETIME_MS,
  SESSION_TOUCH_INTERVAL_MS,
  PLAYBACK_HEARTBEAT_SECONDS,
  PLAYBACK_LEASE_TTL_SECONDS,
  MEDIA_URL_MAX_AGE_SECONDS,
};
