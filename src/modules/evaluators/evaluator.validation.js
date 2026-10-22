const Joi = require("joi");
const { registerSchema } = require("../auth/auth.validation");

// The same fields and rules as student registration. Anything else — a role,
// an evaluator flag, dates — is stripped by the validator and never reaches
// the service: the server decides all of that.
const registerEvaluatorSchema = registerSchema.fork(["address"], (field) => field.strip());

const confirmFeedbackSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "A valid email address is required.",
    "any.required": "Email is required.",
  }),
});

module.exports = { registerEvaluatorSchema, confirmFeedbackSchema };
