const Joi = require("joi");

const ratingField = (name) =>
  Joi.number().integer().min(1).max(5).messages({
    "number.base": `${name} must be a number`,
    "number.integer": `${name} must be an integer`,
    "number.min": `${name} must be between 1 and 5`,
    "number.max": `${name} must be between 1 and 5`,
  });

const submitFeedbackSchema = Joi.object({
  courseId: Joi.string().trim().required().messages({
    "any.required": "courseId is required",
    "string.empty": "courseId cannot be empty",
  }),
  overallRating: ratingField("Overall rating").required().messages({
    "any.required": "Overall rating is required",
  }),
  contentQualityRating: ratingField("Content quality rating").optional().allow(null),
  quizzesRating: ratingField("Quizzes rating").optional().allow(null),
  assignmentsRating: ratingField("Assignments rating").optional().allow(null),
  syllabusRating: ratingField("Syllabus rating").optional().allow(null),
  teachingRating: ratingField("Teaching rating").optional().allow(null),
  comments: Joi.string().trim().max(2000).allow("", null).optional().messages({
    "string.max": "Comments must be 2000 characters or less",
  }),
  // Allow review / rating aliases
  rating: ratingField("Rating").optional(),
  review: Joi.string().trim().max(2000).allow("", null).optional(),
});

module.exports = {
  submitFeedbackSchema,
};
