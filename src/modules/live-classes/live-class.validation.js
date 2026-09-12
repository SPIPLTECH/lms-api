const { body } = require("express-validator");
const validateRequest = require("../../middleware/validation.middleware");

const liveClassCreateValidation = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 255 })
    .withMessage("Title must be 255 characters or less"),

  body("topic")
    .optional()
    .isString()
    .withMessage("Topic must be a string"),

  body("courseId")
    .trim()
    .notEmpty()
    .withMessage("Course ID is required"),

  body("scheduledAt")
    .notEmpty()
    .withMessage("Scheduled date/time is required")
    .isISO8601()
    .withMessage("Scheduled date must be a valid ISO 8601 date"),

  body("duration")
    .optional()
    .isInt({ min: 1, max: 480 })
    .withMessage("Duration must be between 1 and 480 minutes")
    .toInt(),

  body("meetingUrl")
    .optional()
    .isURL()
    .withMessage("Meeting URL must be a valid URL"),

  validateRequest,
];

const liveClassUpdateValidation = [
  body("title")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Title cannot be empty")
    .isLength({ max: 255 })
    .withMessage("Title must be 255 characters or less"),

  body("topic")
    .optional()
    .isString()
    .withMessage("Topic must be a string"),

  body("scheduledAt")
    .optional()
    .isISO8601()
    .withMessage("Scheduled date must be a valid ISO 8601 date"),

  body("duration")
    .optional()
    .isInt({ min: 1, max: 480 })
    .withMessage("Duration must be between 1 and 480 minutes")
    .toInt(),

  body("meetingUrl")
    .optional()
    .isURL()
    .withMessage("Meeting URL must be a valid URL"),

  validateRequest,
];

module.exports = { liveClassCreateValidation, liveClassUpdateValidation };
