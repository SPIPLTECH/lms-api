const { body } = require("express-validator");
const validateRequest = require("../../middleware/validation.middleware");

const setPriceValidation = [
  body("price")
    .isFloat({ min: 0 })
    .withMessage("Price must be a number greater than or equal to 0")
    .toFloat(),

  body("discountPrice")
    .optional({ nullable: true })
    .isFloat({ min: 0 })
    .withMessage("Discount price must be a number greater than or equal to 0")
    .toFloat(),

  body("currency")
    .optional()
    .trim()
    .isLength({ min: 3, max: 3 })
    .withMessage("Currency must be a 3-letter ISO code (e.g. INR, USD)"),

  body("isFree")
    .optional()
    .isBoolean()
    .withMessage("isFree must be a boolean")
    .toBoolean(),

  validateRequest,
];

module.exports = { setPriceValidation };
