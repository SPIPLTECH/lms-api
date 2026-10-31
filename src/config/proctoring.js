/**
 * Proctoring settings. Off by default.
 *
 * PROCTORING_ENABLED turns the feature on. In production PROCTORING_LIVE_ALLOWED
 * must also be "true": the owner sets it only after legal sign-off. Read per call,
 * so a flag change never needs anything but a restart, and tests can toggle it.
 */
const isTrue = (value) => String(value || "").trim().toLowerCase() === "true";

const isProctoringAvailable = (env = process.env) =>
  isTrue(env.PROCTORING_ENABLED) && (env.NODE_ENV !== "production" || isTrue(env.PROCTORING_LIVE_ALLOWED));

/** Longest time limit a proctored quiz may have. */
const MAX_PROCTORED_MINUTES = 480;

module.exports = { isProctoringAvailable, MAX_PROCTORED_MINUTES, isTrue };
