const Joi = require("joi");

const bookmarkCreateSchema = Joi.object({
  type: Joi.string()
    .trim()
    .valid("Lesson", "Video", "Document", "Note", "Web Link", "Course")
    .required()
    .messages({
      "any.required": "Bookmark type is required",
      "string.empty": "Bookmark type cannot be empty",
      "any.only": "Type must be one of: Lesson, Video, Document, Note, Web Link, Course"
    }),
  title: Joi.string().trim().max(255).required().messages({
    "any.required": "Title is required",
    "string.empty": "Title cannot be empty",
    "string.max": "Title must be 255 characters or less"
  }),
  detail: Joi.string().optional().allow(null, ""),
  url: Joi.string().uri().optional().allow(null, "").messages({
    "string.uri": "URL must be a valid URL"
  }),
  courseId: Joi.string().optional().allow(null, ""),
  lessonId: Joi.string().optional().allow(null, "")
});

module.exports = { bookmarkCreateSchema };
