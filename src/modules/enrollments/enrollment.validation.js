const Joi = require("joi");

const createEnrollmentSchema = Joi.object({
  courseId: Joi.string().required().messages({
    "any.required": "Course ID is required"
  }),
});

module.exports = {
  createEnrollmentSchema,
};
