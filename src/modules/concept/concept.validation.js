const Joi = require("joi");

const createConceptSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  subTopicId: Joi.string().required(),
  order: Joi.number().integer().optional().allow(null),
  isPublished: Joi.boolean().optional(),
});

const updateConceptSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  order: Joi.number().integer().optional().allow(null),
  isPublished: Joi.boolean().optional(),
});

module.exports = {
  createConceptSchema,
  updateConceptSchema,
};
