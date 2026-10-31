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

/** Identity matching is on unless AI_IDENTITY_MATCHING says otherwise. */
const isIdentityMatchingEnabled = (env = process.env) =>
  env.AI_IDENTITY_MATCHING === undefined || env.AI_IDENTITY_MATCHING === "" || isTrue(env.AI_IDENTITY_MATCHING);

const DEFAULT_CAPTURE_INTERVAL_SECONDS = 5;

const captureIntervalSeconds = (env = process.env) => {
  const value = Number(env.PROCTORING_CAPTURE_INTERVAL_SECONDS);
  return value >= 1 && value <= 60 ? value : DEFAULT_CAPTURE_INTERVAL_SECONDS;
};

module.exports = {
  captureIntervalSeconds,
  isIdentityMatchingEnabled,
  isProctoringAvailable,
  MAX_PROCTORED_MINUTES,
  isTrue,
};
