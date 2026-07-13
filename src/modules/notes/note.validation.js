const { body } = require("express-validator");
const validateRequest = require("../../middleware/validation.middleware");

const noteCreateValidation = [
  body("title")
    .trim()
    .notEmpty()
    .withMessage("Title is required")
    .isLength({ max: 255 })
    .withMessage("Title must be 255 characters or less"),

  body("content")
    .optional()
    .isString()
    .withMessage("Content must be a string")
    .isLength({ max: 20000 })
    .withMessage("Content must be 20000 characters or less"),

  body("category")
    .optional()
    .isString()
    .withMessage("Category must be a string")
    .isLength({ max: 100 })
    .withMessage("Category must be 100 characters or less"),

  validateRequest,
];

const noteUpdateValidation = [
  body("title")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Title cannot be empty")
    .isLength({ max: 255 })
    .withMessage("Title must be 255 characters or less"),

  body("content")
    .optional()
    .isString()
    .withMessage("Content must be a string")
    .isLength({ max: 20000 })
    .withMessage("Content must be 20000 characters or less"),

  body("category")
    .optional()
    .isString()
    .withMessage("Category must be a string"),

  validateRequest,
];

module.exports = { noteCreateValidation, noteUpdateValidation };
