const { body } = require("express-validator");
const validateRequest = require("../../middleware/validation.middleware");

const bookmarkCreateValidation = [
  body("type")
    .trim()
    .notEmpty()
    .withMessage("Bookmark type is required")
    .isIn(["Lesson", "Video", "Document", "Note", "Web Link", "Course"])
    .withMessage("Type must be one of: Lesson, Video, Document, Note, Web Link, Course"),

  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 255 })
    .withMessage("Title must be 255 characters or less"),

  body("detail")
    .optional()
    .isString()
    .withMessage("Detail must be a string"),

  body("url")
    .optional()
    .isURL()
    .withMessage("URL must be a valid URL"),

  body("courseId")
    .optional()
    .isString()
    .withMessage("Course ID must be a string"),

  body("lessonId")
    .optional()
    .isString()
    .withMessage("Lesson ID must be a string"),

  validateRequest,
];

module.exports = { bookmarkCreateValidation };
