const Joi = require("joi");

// Consent problems are answered by the service with CONSENT_REQUIRED, so an empty
// body gets that message rather than a generic validation error.
const createAttemptSchema = Joi.object({
  consent: Joi.object({
    accepted: Joi.boolean(),
    wordingVersion: Joi.string().max(64),
  }).optional(),
});

const MAX_ANSWER_CHARS = 20000;

const saveAnswerSchema = Joi.object({
  answer: Joi.any()
    .custom((value, helpers) => (JSON.stringify(value ?? null).length > MAX_ANSWER_CHARS ? helpers.error("any.invalid") : value))
    .required(),
  clientRevision: Joi.number().integer().min(0).max(2147483647).required(),
  state: Joi.object({
    status: Joi.string().valid("NOT_VISITED", "VISITED", "ANSWERED", "SKIPPED"),
    visited: Joi.boolean(),
    skipped: Joi.boolean(),
    hintViewed: Joi.boolean(),
    firstVisitedAt: Joi.date().iso().allow(null),
    lastVisitedAt: Joi.date().iso().allow(null),
    answeredAt: Joi.date().iso().allow(null),
    skippedAt: Joi.date().iso().allow(null),
  }).optional(),
});

// What a browser may report. The server's own AI signals are deliberately absent, so
// clients cannot post them, and any severity sent is dropped.
const CLIENT_EVENT_TYPES = [
  "TAB_HIDDEN",
  "TAB_VISIBLE",
  "WINDOW_BLUR",
  "WINDOW_FOCUS",
  "FULLSCREEN_EXIT",
  "FULLSCREEN_ENTER",
  "COPY_ATTEMPT",
  "PASTE_ATTEMPT",
  "CUT_ATTEMPT",
  "CONTEXT_MENU",
  "DISCONNECT",
  "CAMERA_DENIED",
  "CAMERA_INTERRUPTED",
  "SCREENSHOT_ATTEMPT",
  "SCREEN_SHARE_ATTEMPT",
  // Browser voice detection: only durations and levels are sent, never audio.
  "VOICE_ACTIVITY_DETECTED",
  "MICROPHONE_UNAVAILABLE",
];

const monitorEventSchema = Joi.object({
  eventType: Joi.string().valid(...CLIENT_EVENT_TYPES).required(),
  metadata: Joi.object().pattern(Joi.string().max(60), Joi.alternatives(Joi.string().max(500).allow(""), Joi.number(), Joi.boolean(), Joi.valid(null))).max(20).optional(),
  clientTimestamp: Joi.date().iso().optional(),
  seq: Joi.number().integer().min(0).max(10000000).optional(),
});

const heartbeatSchema = Joi.object({
  microphoneStatus: Joi.string().valid("GRANTED", "REFUSED").optional(),
});

const snapshotFieldsSchema = Joi.object({
  type: Joi.string().valid("PRE_EXAM_IDENTITY", "IDENTITY_RECHECK", "PERIODIC_SNAPSHOT", "INCIDENT_SNAPSHOT").default("PERIODIC_SNAPSHOT"),
  frameId: Joi.string().pattern(/^[A-Za-z0-9-]{8,64}$/).optional(),
  clientCapturedAt: Joi.string().isoDate().optional(),
});

module.exports = { createAttemptSchema, heartbeatSchema, monitorEventSchema, saveAnswerSchema, snapshotFieldsSchema };
