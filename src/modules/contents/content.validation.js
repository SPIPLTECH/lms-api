const Joi = require("joi");

const createContentSchema = Joi.object({
  topicId: Joi.string().required(),
  type: Joi.string()
    .valid("VIDEO", "DOCUMENT", "PRESENTATION", "HTML", "LINK")
    .required()
    .messages({
      "any.only": "Content type must be one of VIDEO, DOCUMENT, PRESENTATION, HTML, LINK"
    }),
  order: Joi.number().integer().optional().allow(null),
  title: Joi.string().optional().allow(null, ""),
  videoUrl: Joi.string().uri().optional().allow(null, ""),
  fileUrl: Joi.string().uri().optional().allow(null, ""),
  htmlContent: Joi.string().optional().allow(null, ""),
  externalUrl: Joi.string().uri().optional().allow(null, ""),
  duration: Joi.number().integer().min(0).optional().allow(null),
});

const updateContentSchema = Joi.object({
  order: Joi.number().integer().optional().allow(null),
  title: Joi.string().optional().allow(null, ""),
  videoUrl: Joi.string().uri().optional().allow(null, ""),
  fileUrl: Joi.string().uri().optional().allow(null, ""),
  htmlContent: Joi.string().optional().allow(null, ""),
  externalUrl: Joi.string().uri().optional().allow(null, ""),
  duration: Joi.number().integer().min(0).optional().allow(null),
});

module.exports = {
  createContentSchema,
  updateContentSchema
};
