const Joi = require("joi");

const createDiscussionSchema = Joi.object({
  courseId: Joi.string().required(),
  title: Joi.string().min(1).max(200).required(),
  body: Joi.string().min(1).max(5000).required()
});

const createReplySchema = Joi.object({
  body: Joi.string().min(1).max(5000).required()
});

const updateDiscussionSchema = Joi.object({
  isPinned: Joi.boolean().optional(),
  isLocked: Joi.boolean().optional()
});

module.exports = {
  createDiscussionSchema,
  createReplySchema,
  updateDiscussionSchema
};
