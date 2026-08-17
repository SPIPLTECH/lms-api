const Joi = require("joi");
const { EVENT_TYPES, EVENT_CATEGORIES, MAX_PAYLOAD_BYTES } = require("../constants");

const eventTypeValues = Object.values(EVENT_TYPES);
const eventCategoryValues = Object.values(EVENT_CATEGORIES);

const cuid = Joi.string().min(1).max(64);

/**
 * Body schema for POST /events.
 * `eventCategory` is intentionally NOT accepted here — it is always derived
 * server-side from `eventType` (see constants/eventCategoryMap.constants.js).
 */
const createEventSchema = Joi.object({
  eventType: Joi.string().valid(...eventTypeValues).required(),
  studentId: cuid.optional(),
  courseId: cuid.optional().allow(null),
  moduleId: cuid.optional().allow(null),
  lessonId: cuid.optional().allow(null),
  contentId: cuid.optional().allow(null),
  quizId: cuid.optional().allow(null),
  assignmentId: cuid.optional().allow(null),
  sessionId: Joi.string().min(1).max(128).optional(),
  payload: Joi.object().unknown(true).max(50).optional()
    .custom((value, helpers) => {
      if (value && Buffer.byteLength(JSON.stringify(value)) > MAX_PAYLOAD_BYTES) {
        return helpers.error("any.invalid");
      }
      return value;
    }, "payload size guard"),
  metadata: Joi.object().unknown(true).max(50).optional(),
  source: Joi.string().max(100).optional(),
  clientTimestamp: Joi.date().iso().optional(),
});

const listQuerySchema = Joi.object({
  eventType: Joi.string().valid(...eventTypeValues).optional(),
  eventCategory: Joi.string().valid(...eventCategoryValues).optional(),
  courseId: cuid.optional(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().min(Joi.ref("startDate")).optional(),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const statisticsQuerySchema = Joi.object({
  studentId: cuid.optional(),
  courseId: cuid.optional(),
  startDate: Joi.date().iso().optional(),
  endDate: Joi.date().iso().min(Joi.ref("startDate")).optional(),
});

const todayQuerySchema = Joi.object({
  studentId: cuid.optional(),
});

module.exports = {
  createEventSchema,
  listQuerySchema,
  statisticsQuerySchema,
  todayQuerySchema,
};
