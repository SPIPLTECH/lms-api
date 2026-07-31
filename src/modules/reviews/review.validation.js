const Joi = require("joi");

const reviewCreateSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).required().messages({
    "number.min": "Rating must be an integer between 1 and 5",
    "number.max": "Rating must be an integer between 1 and 5"
  }),
  review: Joi.string().max(1000).optional().allow(null, "").messages({
    "string.max": "Review must be 1000 characters or less"
  }),
  courseId: Joi.string().required().messages({
    "any.required": "Course ID is required"
  })
});

const reviewUpdateSchema = Joi.object({
  rating: Joi.number().integer().min(1).max(5).optional().messages({
    "number.min": "Rating must be an integer between 1 and 5",
    "number.max": "Rating must be an integer between 1 and 5"
  }),
  courseId: Joi.string().trim().optional().messages({
    "string.empty": "Course ID cannot be empty"
  }),
  review: Joi.string().max(1000).optional().allow(null, "").messages({
    "string.max": "Review must be 1000 characters or less"
  })
});

module.exports = {
  reviewCreateSchema,
  reviewUpdateSchema
};
