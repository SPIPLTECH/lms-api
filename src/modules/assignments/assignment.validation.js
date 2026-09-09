const Joi = require("joi");

const attachmentSchema = Joi.object({
  url: Joi.string().uri().required(),
  name: Joi.string().required(),
  type: Joi.string().optional().allow(null, "")
});

const createAssignmentSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  courseId: Joi.string().optional(),
  moduleId: Joi.string().optional(),
  lessonId: Joi.string().optional(),
  topicId: Joi.string().optional(),
  dueDate: Joi.date().iso().required(),
  startDate: Joi.date().iso().optional().allow(null),
  availableFrom: Joi.date().iso().optional().allow(null),
  availableUntil: Joi.date().iso().optional().allow(null),
  totalQuestions: Joi.number().integer().min(0).optional().allow(null),
  estimatedTime: Joi.number().integer().min(0).optional().allow(null),
  resources: Joi.number().integer().min(0).optional().allow(null),
  marks: Joi.number().integer().min(0).optional().allow(null),
  assessmentType: Joi.string().optional().allow(null, ""),
  attachments: Joi.array().items(attachmentSchema).optional(),
  isPublished: Joi.boolean().optional(),
  status: Joi.string().optional().allow(null, "")
})
  .xor("courseId", "moduleId", "lessonId", "topicId")
  .messages({
    "object.missing": "Assignment must be attached to exactly one of course, module, lesson, or topic.",
    "object.xor": "Assignment must be attached to exactly one of course, module, lesson, or topic.",
  });

const updateAssignmentSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  dueDate: Joi.date().iso().optional(),
  startDate: Joi.date().iso().optional().allow(null),
  availableFrom: Joi.date().iso().optional().allow(null),
  availableUntil: Joi.date().iso().optional().allow(null),
  totalQuestions: Joi.number().integer().min(0).optional().allow(null),
  estimatedTime: Joi.number().integer().min(0).optional().allow(null),
  resources: Joi.number().integer().min(0).optional().allow(null),
  marks: Joi.number().integer().min(0).optional().allow(null),
  assessmentType: Joi.string().optional().allow(null, ""),
  attachments: Joi.array().items(attachmentSchema).optional(),
  isPublished: Joi.boolean().optional(),
  status: Joi.string().optional().allow(null, "")
});

// The student's final answer is one uploaded PDF. The file is already in blob
// storage by the time this runs (the upload route enforces PDF as well), so
// these checks are the server-side half of that rule rather than a substitute
// for it: a caller hitting this endpoint directly still cannot register a
// non-PDF, or a submission carrying no file at all.
const PDF_URL_PATTERN = /\.pdf(\?|#|$)/i;

const submitAssignmentSchema = Joi.object({
  status: Joi.string().valid("Submitted", "Draft").optional(),
  fileUrl: Joi.string()
    .uri()
    .pattern(PDF_URL_PATTERN)
    .required()
    .messages({
      "string.pattern.base": "The submitted file must be a PDF.",
      "any.required": "A completed assignment PDF is required to submit."
    }),
  fileName: Joi.string()
    .pattern(/\.pdf$/i)
    .required()
    .messages({ "string.pattern.base": "The submitted file must be a PDF." }),
  fileSize: Joi.number().integer().min(1).optional().allow(null),
  fileType: Joi.string()
    .valid("application/pdf")
    .optional()
    .allow(null, "")
    .messages({ "any.only": "The submitted file must be a PDF." })
});

module.exports = {
  createAssignmentSchema,
  updateAssignmentSchema,
  submitAssignmentSchema
};
