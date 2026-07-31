const Joi = require("joi");

const setPriceSchema = Joi.object({
  price: Joi.number().min(0).messages({
    "number.min": "Price must be a number greater than or equal to 0"
  }),
  discountPrice: Joi.number().min(0).optional().allow(null).messages({
    "number.min": "Discount price must be a number greater than or equal to 0"
  }),
  currency: Joi.string().length(3).optional().allow(null, "").messages({
    "string.length": "Currency must be a 3-letter ISO code (e.g. INR, USD)"
  }),
  isFree: Joi.boolean().optional()
});

module.exports = { setPriceSchema };
