const Joi = require("joi");

const createConversationSchema = Joi.object({
    type: Joi.string()
        .valid("DIRECT", "GROUP")
        .required(),

    name: Joi.when("type", {
        is: "GROUP",
        then: Joi.string()
            .trim()
            .min(3)
            .max(100)
            .required(),
        otherwise: Joi.forbidden(),
    }),

    participantIds: Joi.array()
        .items(Joi.string().required())
        .min(1)
        .required(),
});

const updateConversationSchema = Joi.object({
    name: Joi.string().trim().optional(),
    description: Joi.string().trim().allow("").optional(),
    image: Joi.string().uri().allow(null, "").optional(),
});

module.exports = {
    createConversationSchema,
    updateConversationSchema,
};