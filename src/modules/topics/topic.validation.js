const Joi = require("joi");

const createTopicSchema = Joi.object({
  title: Joi.string().required(),
  description: Joi.string().optional().allow(null, ""),
  lessonId: Joi.string().required(),
  order: Joi.number().integer().optional().allow(null),
  isPublished: Joi.boolean().optional(),
});

const updateTopicSchema = Joi.object({
  title: Joi.string().optional(),
  description: Joi.string().optional().allow(null, ""),
  order: Joi.number().integer().optional().allow(null),
  isPublished: Joi.boolean().optional(),
});

const reorderTopicsSchema = Joi.object({
  lessonId: Joi.string().required(),
  topics: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        order: Joi.number().integer().min(0).required(),
      })
    )
    .min(1)
    .required(),
});

module.exports = {
  createTopicSchema,
  updateTopicSchema,
  reorderTopicsSchema,
};
