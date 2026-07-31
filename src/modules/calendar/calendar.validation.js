const Joi = require("joi");

const createEventSchema = Joi.object({
  title: Joi.string().required(),
  type: Joi.string().required(),
  date: Joi.string().required(),
  startTime: Joi.string().allow(null, ""),
  endTime: Joi.string().allow(null, ""),
  description: Joi.string().allow(null, ""),
  instructorId: Joi.string().allow(null, ""),
  instructorName: Joi.string().allow(null, ""),
  link: Joi.string().allow(null, ""),
  maxMarks: Joi.number().allow(null),
  courseId: Joi.string().allow(null, ""),
  courseName: Joi.string().allow(null, ""),
  duration: Joi.string().allow(null, "") // In case frontend sends duration directly
});

module.exports = {
  createEventSchema
};
