const Joi = require("joi");

const courseExtraFields = {
  visibility: Joi.string().valid("PUBLIC", "PRIVATE", "UNLISTED").optional(),
  language: Joi.string().max(50).optional().allow(null, ""),
  tags: Joi.array().items(Joi.string().max(50)).optional(),
  certificatesEnabled: Joi.boolean().optional(),
  discussionEnabled: Joi.boolean().optional(),
  dripContentEnabled: Joi.boolean().optional(),
  estimatedLearningHours: Joi.number().min(0).max(10000).optional().allow(null)
};

const createCourseSchema = Joi.object({
  title: Joi.string().required().messages({
    "any.required": "Title is required",
    "string.empty": "Title cannot be empty"
  }),
  description: Joi.string().optional().allow(null, ""),
  category: Joi.string().optional().allow(null, ""),
  level: Joi.string().optional().allow(null, ""),
  thumbnailUrl: Joi.string().uri().optional().allow(null, ""),
  status: Joi.string().valid("DRAFT", "PUBLISHED", "ARCHIVED").optional(),
  ...courseExtraFields
});

const updateCourseSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  category: Joi.string().optional().allow(null, ""),
  level: Joi.string().optional().allow(null, ""),
  thumbnailUrl: Joi.string().uri().optional().allow(null, ""),
  ...courseExtraFields
});

const updateCourseStatusSchema = Joi.object({
  status: Joi.string()
    .valid("DRAFT", "PUBLISHED", "ARCHIVED")
    .required()
    .messages({
      "any.required": "Status is required",
      "any.only": "Status must be DRAFT, PUBLISHED, or ARCHIVED"
    })
});

const sendAnnouncementSchema = Joi.object({
  title: Joi.string().required(),
  content: Joi.string().required()
});

const createCourseBatchSchema = Joi.object({
  name: Joi.string().required(),
  startDate: Joi.date().iso().required(),
  dueDate: Joi.date().iso().min(Joi.ref('startDate')).optional().allow(null, ""),
  startTime: Joi.string().optional().allow(null, ""),
  endTime: Joi.string().optional().allow(null, ""),
  meetingLink: Joi.string().uri().optional().allow(null, ""),
  status: Joi.string().valid("ACTIVE", "ARCHIVED", "COMPLETED").optional(),
  isPublished: Joi.boolean().optional()
});

module.exports = {
  createCourseSchema,
  updateCourseSchema,
  updateCourseStatusSchema,
  sendAnnouncementSchema,
  createCourseBatchSchema
};
