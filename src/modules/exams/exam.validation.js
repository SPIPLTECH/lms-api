const Joi = require("joi");

const createExamSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  instructions: Joi.string().optional().allow(null, ""),
  courseId: Joi.string().required(),
  batchId: Joi.string().optional().allow(null, ""),
  duration: Joi.number().integer().min(1).optional().allow(null),
  startDate: Joi.date().iso().required(),
  dueDate: Joi.date().iso().optional().allow(null),
  isPublished: Joi.boolean().optional(),
  status: Joi.string().optional().allow(null, "")
});

const updateExamSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  instructions: Joi.string().optional().allow(null, ""),
  batchId: Joi.string().optional().allow(null, ""),
  duration: Joi.number().integer().min(1).optional().allow(null),
  startDate: Joi.date().iso().optional(),
  dueDate: Joi.date().iso().optional().allow(null),
  isPublished: Joi.boolean().optional(),
  status: Joi.string().optional().allow(null, "")
});

module.exports = {
  createExamSchema,
  updateExamSchema
};
