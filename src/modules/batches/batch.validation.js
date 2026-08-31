const Joi = require("joi");

const createBatchSchema = Joi.object({
  name: Joi.string().required(),
  startDate: Joi.date().iso().required(),
  dueDate: Joi.date().iso().min(Joi.ref("startDate")).optional().allow(null, ""),
  availableFrom: Joi.date().iso().optional().allow(null, ""),
  availableUntil: Joi.date().iso().min(Joi.ref("startDate")).optional().allow(null, ""),
  startTime: Joi.string().optional().allow(null, ""),
  endTime: Joi.string().optional().allow(null, ""),
  meetingLink: Joi.string().uri().optional().allow(null, ""),
  status: Joi.string().valid("ACTIVE", "ARCHIVED", "COMPLETED").optional(),
  isPublished: Joi.boolean().optional(),
  courseIds: Joi.array().items(Joi.string()).min(1).required().messages({
    "array.min": "At least one courseId is required",
    "any.required": "courseIds is required",
  }),
});

const updateBatchSchema = Joi.object({
  name: Joi.string().optional(),
  startDate: Joi.date().iso().optional(),
  dueDate: Joi.date().iso().optional().allow(null, ""),
  availableFrom: Joi.date().iso().optional().allow(null, ""),
  availableUntil: Joi.date().iso().optional().allow(null, ""),
  startTime: Joi.string().optional().allow(null, ""),
  endTime: Joi.string().optional().allow(null, ""),
  meetingLink: Joi.string().uri().optional().allow(null, ""),
  status: Joi.string().valid("ACTIVE", "ARCHIVED", "COMPLETED").optional(),
  isPublished: Joi.boolean().optional(),
  courseIds: Joi.array().items(Joi.string()).min(1).optional(),
});

const updateBatchStatusSchema = Joi.object({
  status: Joi.string()
    .valid("ACTIVE", "ARCHIVED", "COMPLETED")
    .required()
    .messages({
      "any.required": "Status is required",
      "any.only": "Status must be ACTIVE, ARCHIVED, or COMPLETED",
    }),
});

const addStudentToBatchSchema = Joi.object({
  studentId: Joi.string().required().messages({
    "any.required": "studentId is required",
    "string.empty": "studentId is required",
  }),
});

const createBatchAnnouncementSchema = Joi.object({
  title: Joi.string().required().messages({
    "any.required": "Title is required",
    "string.empty": "Title cannot be empty",
  }),
  message: Joi.string().required().messages({
    "any.required": "Message is required",
    "string.empty": "Message cannot be empty",
  }),
});

module.exports = {
  createBatchSchema,
  updateBatchSchema,
  updateBatchStatusSchema,
  addStudentToBatchSchema,
  createBatchAnnouncementSchema,
};
