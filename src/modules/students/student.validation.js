const Joi = require("joi");

const updateStudentSchema = Joi.object({
  education: Joi.string().optional().allow(null, ""),
  phone: Joi.string()
    .pattern(/^\+?[0-9]{7,15}$/)
    .optional()
    .allow(null, ""),
  dateOfBirth: Joi.date().iso().optional().allow(null),
  guardianName: Joi.string().optional().allow(null, ""),
  profileVisibility: Joi.string()
    .valid("Public", "Private")
    .optional()
    .allow(null, ""),
  focusTopics: Joi.string().optional().allow(null, ""),
  interests: Joi.string().optional().allow(null, ""),
  learningGoals: Joi.string().optional().allow(null, ""),
  videoQuality: Joi.string().optional().allow(null, ""),
  downloadOverWifi: Joi.boolean().optional(),
  language: Joi.string().optional().allow(null, ""),
  timezone: Joi.string().optional().allow(null, ""),
  themeMode: Joi.string().optional().allow(null, ""),
  plan: Joi.string().optional().allow(null, ""),
});

module.exports = {
  updateStudentSchema,
};
