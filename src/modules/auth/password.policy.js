const Joi = require("joi");

/**
 * Password policy — the single source of truth for every place a password is
 * set (register, reset, change, admin create). The frontend mirrors this in
 * src/lib/passwordPolicy.js; keep the two in step.
 *
 * 8–128 characters, no whitespace, at least one lowercase letter, one
 * uppercase letter, one digit and one special character.
 */
const PASSWORD_REGEX =
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9\s])\S{8,128}$/;

const PASSWORD_POLICY_MESSAGE =
  "Password must be 8–128 characters with no spaces, and include an uppercase letter, a lowercase letter, a number and a special character.";

const passwordField = (label = "Password") =>
  Joi.string()
    .pattern(PASSWORD_REGEX)
    .required()
    .messages({
      "string.pattern.base": PASSWORD_POLICY_MESSAGE,
      "string.empty": `${label} is required.`,
      "any.required": `${label} is required.`,
    });

module.exports = {
  PASSWORD_REGEX,
  passwordField,
};
