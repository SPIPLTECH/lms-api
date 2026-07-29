const Joi = require("joi");

const updateTeacherSchema = Joi.object({
  specialization: Joi.string().optional().allow(null, ""),
  qualification: Joi.string().optional().allow(null, ""),
  experience: Joi.number().integer().min(0).max(100).optional().allow(null),
  bio: Joi.string().max(2000).optional().allow(null, ""),
});

module.exports = {
  updateTeacherSchema,
};
