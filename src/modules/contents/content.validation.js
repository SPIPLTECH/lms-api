const Joi = require("joi");

const VALID_CONTENT_TYPES = [
  "VIDEO",
  "DOCUMENT",
  "TEXT",
  "LINK",
  "PRESENTATION",
  "IMAGE",
  "PDF",
  "FILE",
  "EXTERNAL_LINK",
  "HTML",
  "CODE",
  "ASSIGNMENT",
  "CODING_EXERCISE",
  "SCORM",
  "INTERACTIVE_LAB",
  "AUDIO",
  "EMBED",
  "SLIDE",
];

const createContentSchema = Joi.object({
  courseId: Joi.string().optional(),
  moduleId: Joi.string().optional(),
  lessonId: Joi.string().optional(),
  topicId: Joi.string().optional(),
  type: Joi.string()
    .valid(...VALID_CONTENT_TYPES)
    .required()
    .messages({
      "any.only": `Content type must be one of ${VALID_CONTENT_TYPES.join(", ")}`,
    }),
  order: Joi.number().integer().optional().allow(null),
  title: Joi.string().optional().allow(null, ""),
  videoUrl: Joi.string().optional().allow(null, ""),
  fileUrl: Joi.string().optional().allow(null, ""),
  htmlContent: Joi.string().optional().allow(null, ""),
  externalUrl: Joi.string().optional().allow(null, ""),
  duration: Joi.number().integer().min(0).optional().allow(null),
  data: Joi.object().optional().allow(null),
  parentContentId: Joi.string().optional().allow(null, ""),
})
  .xor("courseId", "moduleId", "lessonId", "topicId")
  .messages({
    "object.missing": "Content must be attached to exactly one of course, module, lesson, or topic.",
    "object.xor": "Content must be attached to exactly one of course, module, lesson, or topic.",
  });

const updateContentSchema = Joi.object({
  type: Joi.string().valid(...VALID_CONTENT_TYPES).optional(),
  order: Joi.number().integer().optional().allow(null),
  title: Joi.string().optional().allow(null, ""),
  videoUrl: Joi.string().optional().allow(null, ""),
  fileUrl: Joi.string().optional().allow(null, ""),
  htmlContent: Joi.string().optional().allow(null, ""),
  externalUrl: Joi.string().optional().allow(null, ""),
  duration: Joi.number().integer().min(0).optional().allow(null),
  data: Joi.object().optional().allow(null),
  parentContentId: Joi.string().optional().allow(null, ""),
});

module.exports = {
  createContentSchema,
  updateContentSchema,
};
