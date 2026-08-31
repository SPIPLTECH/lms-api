const Joi = require("joi");

const createOrderSchema = Joi.object({
  courseId: Joi.string().required().messages({
    "string.empty": "Course ID is required",
    "any.required": "Course ID is required",
  }),
});

const verifyPaymentSchema = Joi.object({
  razorpayOrderId: Joi.string().required().messages({
    "string.empty": "Razorpay order ID is required",
    "any.required": "Razorpay order ID is required",
  }),
  razorpayPaymentId: Joi.string().required().messages({
    "string.empty": "Razorpay payment ID is required",
    "any.required": "Razorpay payment ID is required",
  }),
  razorpaySignature: Joi.string().required().messages({
    "string.empty": "Razorpay signature is required",
    "any.required": "Razorpay signature is required",
  }),
});

module.exports = {
  createOrderSchema,
  verifyPaymentSchema,
};
