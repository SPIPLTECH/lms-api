const Joi = require("joi");

const attachmentSchema = Joi.object({
  url: Joi.string().uri().required(),
  name: Joi.string().required(),
  type: Joi.string().optional().allow(null, "")
});

const createAssignmentSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  courseId: Joi.string().required(),
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

const submitAssignmentSchema = Joi.object({
  status: Joi.string().valid("Submitted", "Draft").optional(),
});

module.exports = {
  createAssignmentSchema,
  updateAssignmentSchema,
  submitAssignmentSchema
};
