const Joi = require("joi");

const sendMessageSchema = Joi.object({
    conversationId: Joi.string()
        .required(),

    content: Joi.string()
        .trim()
        .max(5000)
        .when("attachments", {
            is: Joi.exist().not(null),
            then: Joi.string().optional().allow(""),
            otherwise: Joi.string().min(1).required(),
        }),

    attachments: Joi.array()
        .items(
            Joi.object({
                fileName: Joi.string().required(),
                fileUrl: Joi.string().required(),
                mimeType: Joi.string().required(),
                size: Joi.number().integer().positive().required(),
                type: Joi.string().valid("IMAGE", "VIDEO", "DOCUMENT", "AUDIO", "OTHER").required(),
            })
        )
        .optional(),
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