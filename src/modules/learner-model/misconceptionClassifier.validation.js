const Joi = require("joi");
const { MISCONCEPTION_TAXONOMY } = require("./misconceptionTaxonomy.config");

const MISCONCEPTION_TYPES = Object.keys(MISCONCEPTION_TAXONOMY);

/**
 * Strict schema for the classifier LLM's JSON output. `type` is
 * independently constrained to the controlled taxonomy right here — the
 * model is never trusted to self-limit to the list in its own prompt.
 * Any value outside MISCONCEPTION_TAXONOMY fails validation exactly like a
 * malformed response, regardless of how confident or well-formed the rest
 * of the JSON is.
 */
const classifierOutputSchema = Joi.object({
  detected: Joi.boolean().required(),
  type: Joi.string()
    .valid(...MISCONCEPTION_TYPES)
    .when("detected", { is: true, then: Joi.required(), otherwise: Joi.optional() }),
  description: Joi.string()
    .max(300)
    .when("detected", { is: true, then: Joi.required(), otherwise: Joi.optional() }),
  confidence: Joi.number()
    .min(0)
    .max(1)
    .when("detected", { is: true, then: Joi.required(), otherwise: Joi.optional() }),
}).unknown(true); // tolerate extra noise keys the model might add; never relax the checked ones

module.exports = { classifierOutputSchema };
