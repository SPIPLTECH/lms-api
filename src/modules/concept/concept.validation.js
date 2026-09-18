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

const reorderConceptsSchema = Joi.object({
  subTopicId: Joi.string().required(),
  concepts: Joi.array()
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
  createConceptSchema,
  updateConceptSchema,
  reorderConceptsSchema,
};
