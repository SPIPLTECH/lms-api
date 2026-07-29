const Joi = require("joi");

const createCourseSchema = Joi.object({
  title: Joi.string().required().messages({
    "any.required": "Title is required",
    "string.empty": "Title cannot be empty"
  }),
  description: Joi.string().optional().allow(null, ""),
  category: Joi.string().optional().allow(null, ""),
  level: Joi.string().optional().allow(null, ""),
  thumbnailUrl: Joi.string().uri().optional().allow(null, ""),
  status: Joi.string().valid("DRAFT", "PUBLISHED", "ARCHIVED").optional()
});

const updateCourseSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  category: Joi.string().optional().allow(null, ""),
  level: Joi.string().optional().allow(null, ""),
  thumbnailUrl: Joi.string().uri().optional().allow(null, ""),
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
  endDate: Joi.date().iso().min(Joi.ref('startDate')).required(),
  maxStudents: Joi.number().integer().min(1).optional()
});

module.exports = {
  createCourseSchema,
  updateCourseSchema,
  updateCourseStatusSchema,
  sendAnnouncementSchema,
  createCourseBatchSchema
};
