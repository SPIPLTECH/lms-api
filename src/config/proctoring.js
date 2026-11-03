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

const intOf = (env, key, fallback) => {
  const value = Number(env[key]);
  return env[key] !== undefined && env[key] !== "" && Number.isFinite(value) ? value : fallback;
};

const positiveOf = (env, key, fallback) => {
  const value = intOf(env, key, fallback);
  return value > 0 ? value : fallback;
};

const boolOf = (env, key, fallback) => (env[key] === undefined || env[key] === "" ? fallback : isTrue(env[key]));

/** Only these rules can end an exam. Every other rule flags it for review. */
const DEFAULT_TERMINATING_RULES = ["CONFIRMED_PROHIBITED_OBJECT", "PERSISTENT_MULTIPLE_FACES"];

/** Monitoring thresholds, with ProctorGuard's defaults unless the owner decided otherwise. */
const proctoringSettings = (env = process.env) => ({
  autoTerminate: boolOf(env, "AI_AUTO_TERMINATE_ENABLED", true),
  terminateOnWarningLimit: boolOf(env, "PROCTORING_TERMINATE_ON_WARNING_LIMIT", true),
  terminatingRules: env.AI_TERMINATING_RULES
    ? env.AI_TERMINATING_RULES.split(",").map((rule) => rule.trim()).filter(Boolean)
    : DEFAULT_TERMINATING_RULES,
  minConfidence: intOf(env, "AI_AUTO_TERMINATE_MIN_CONFIDENCE", 0.8),
  objectMinConfidence: intOf(env, "AI_AUTO_TERMINATE_OBJECT_MIN_CONFIDENCE", 0.6),
  // 0.5: a phone held up close scored 0.543 once and was then missed; faces alone score under 0.15.
  objectWarnMinConfidence: intOf(env, "AI_OBJECT_WARN_MIN_CONFIDENCE", 0.5),
  persistSeconds: intOf(env, "AI_TERMINATE_PERSIST_SECONDS", 10),
  faceAbsentConsecutive: intOf(env, "AI_FACE_ABSENT_CONSECUTIVE", 2),
  faceAbsentSustainedSeconds: intOf(env, "AI_FACE_ABSENT_SUSTAINED_SECONDS", 4),
  faceMultipleConsecutive: intOf(env, "AI_FACE_MULTIPLE_CONSECUTIVE", 1),
  objectConsecutive: intOf(env, "AI_OBJECT_CONSECUTIVE", 1),
  headPoseConsecutive: intOf(env, "AI_HEAD_POSE_CONSECUTIVE", 2),
  headPoseSustainedSeconds: intOf(env, "AI_HEAD_POSE_SUSTAINED_SECONDS", 5),
  headPoseMinFaceScore: intOf(env, "AI_HEAD_POSE_MIN_FACE_SCORE", 0.6),
  headPoseYawDeg: intOf(env, "AI_HEAD_POSE_YAW_DEG", 35),
  headPosePitchDeg: intOf(env, "AI_HEAD_POSE_PITCH_DEG", 0),
  episodeClearFrames: Math.max(1, intOf(env, "AI_EPISODE_CLEAR_FRAMES", 2)),
  episodeClearSeconds: intOf(env, "AI_EPISODE_CLEAR_SECONDS", 10),
  identityMatchThreshold: intOf(env, "AI_IDENTITY_MATCH_THRESHOLD", 0.363),
  identityMismatchConsecutive: intOf(env, "AI_IDENTITY_MISMATCH_CONSECUTIVE", 2),
  identityFlagConsecutive: intOf(env, "AI_IDENTITY_TERMINATE_CONSECUTIVE", 3),
  correlationWindowSeconds: intOf(env, "AI_CORRELATION_WINDOW_SECONDS", 120),
  correlationMinSignals: Math.max(2, intOf(env, "AI_CORRELATION_MIN_SIGNALS", 2)),
  alertDedupSeconds: intOf(env, "AI_ALERT_DEDUP_SECONDS", 300),
  voiceCooldownSeconds: intOf(env, "AI_VAD_COOLDOWN_SECONDS", 30),
  studentWarnings: boolOf(env, "AI_STUDENT_WARNINGS", true),
  recheckSeconds: intOf(env, "AI_RECHECK_SECONDS", 2),
  // How long an upload may be held for the AI's answer. None: decisions reach the page through
  // the notice channel, so a slow AI never holds an upload open.
  uploadWaitMs: intOf(env, "AI_UPLOAD_WAIT_MS", 0),
  noticeHoldSeconds: positiveOf(env, "PROCTORING_NOTICE_HOLD_SECONDS", 25),
  identityWaitMs: intOf(env, "AI_IDENTITY_WAIT_MS", 8000),
  aiTimeoutMs: intOf(env, "AI_SERVICE_TIMEOUT_MS", 3000),
  objectDetection: boolOf(env, "AI_OBJECT_DETECTION", true),
  queueConcurrency: intOf(env, "AI_ANALYSIS_CONCURRENCY", 2),
  queueMax: intOf(env, "AI_ANALYSIS_QUEUE_MAX", 500),
  uploadGapSeconds: intOf(env, "PROCTORING_UPLOAD_GAP_SECONDS", 60),
  // Nonsense falls back to the default, so a bad setting can never delete evidence early.
  cleanRetentionDays: positiveOf(env, "PROCTORING_CLEAN_RETENTION_DAYS", 7),
  violationRetentionDays: positiveOf(env, "PROCTORING_VIOLATION_RETENTION_DAYS", 90),
});

module.exports = {
  proctoringSettings,
  captureIntervalSeconds,
  isIdentityMatchingEnabled,
  isProctoringAvailable,
  MAX_PROCTORED_MINUTES,
  isTrue,
};
