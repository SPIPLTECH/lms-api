const Joi = require("joi");

const createLessonQuerySchema = Joi.object({
  lessonId: Joi.string().required(),
  question: Joi.string().min(1).max(2000).required()
});

const replyLessonQuerySchema = Joi.object({
  reply: Joi.string().min(1).max(2000).required()
});

const updateStatusSchema = Joi.object({
  status: Joi.string().valid("PENDING", "ANSWERED").required()
});

module.exports = {
  createLessonQuerySchema,
  replyLessonQuerySchema,
  updateStatusSchema
};
