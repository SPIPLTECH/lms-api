const Joi = require("joi");

const id = (label) =>
  Joi.string().trim().min(1).max(64).required().messages({
    "any.required": `${label} is required.`,
    "string.empty": `${label} is required.`,
  });

const startPlaybackSchema = Joi.object({
  contentId: id("contentId"),
});

const heartbeatSchema = Joi.object({
  leaseId: id("leaseId"),
});

const stopPlaybackSchema = Joi.object({
  leaseId: id("leaseId"),
  contentId: Joi.string().trim().max(64).optional(),
  reason: Joi.string()
    .valid("USER_STOPPED", "NAVIGATED_AWAY", "PAGE_HIDDEN", "CONTENT_CHANGED", "ENDED")
    .optional(),
});

module.exports = {
  startPlaybackSchema,
  heartbeatSchema,
  stopPlaybackSchema,
};
