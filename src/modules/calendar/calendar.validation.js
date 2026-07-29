const Joi = require("joi");

const createEventSchema = Joi.object({
  title: Joi.string().required(),
  type: Joi.string().required(),
  date: Joi.string().required() // Assuming string since schema says String, could be ISO date
});

module.exports = {
  createEventSchema
};
