const Joi = require("joi");

const sendMessageSchema = Joi.object({
    conversationId: Joi.string()
        .required(),

    content: Joi.string()
        .trim()
        .min(1)
        .max(5000)
        .required(),
});

const updateMessageSchema = Joi.object({
    content: Joi.string()
        .trim()
        .min(1)
        .max(5000)
        .required(),
});

module.exports = {
    sendMessageSchema,
    updateMessageSchema,
};