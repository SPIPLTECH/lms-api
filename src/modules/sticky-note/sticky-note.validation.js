const { body } = require("express-validator");

const validateRequest = require("../../middleware/validation.middleware");

const stickyNoteCreateValidation = [
  body("lessonId")
    .trim()
    .notEmpty()
    .withMessage("Lesson ID is required"),

  body("content")
    .trim()
    .notEmpty()
    .withMessage("Content is required")
    .isLength({ max: 5000 })
    .withMessage(
      "Content must be 5000 characters or less"
    ),

  body("color")
    .optional()
    .isString()
    .withMessage("Color must be a string"),

  body("timestamp")
    .optional()
    .isInt({ min: 0 })
    .withMessage(
      "Timestamp must be a positive integer"
    )
    .toInt(),

  validateRequest
];

const stickyNoteUpdateValidation = [
  body("content")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Content cannot be empty")
    .isLength({ max: 5000 })
    .withMessage(
      "Content must be 5000 characters or less"
    ),

  body("color")
    .optional()
    .isString()
    .withMessage("Color must be a string"),

  body("timestamp")
    .optional()
    .isInt({ min: 0 })
    .withMessage(
      "Timestamp must be a positive integer"
    )
    .toInt(),

  body("isPinned")
    .optional()
    .isBoolean()
    .withMessage(
      "isPinned must be true or false"
    )
    .toBoolean(),

  validateRequest
];

module.exports = {
  stickyNoteCreateValidation,
  stickyNoteUpdateValidation
};