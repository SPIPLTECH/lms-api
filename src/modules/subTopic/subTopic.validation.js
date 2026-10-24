const Joi = require("joi");

const createSubTopicSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  topicId: Joi.string().required(),
  order: Joi.number().integer().optional().allow(null),
  isPublished: Joi.boolean().optional(),
});

const updateSubTopicSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  order: Joi.number().integer().optional().allow(null),
  isPublished: Joi.boolean().optional(),
});

module.exports = {
  createSubTopicSchema,
  updateSubTopicSchema,
};
