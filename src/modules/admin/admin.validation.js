const { body } = require("express-validator");

/* Create Admin Validation */
const createAdminValidation = [
  body("name")
    .notEmpty()
    .withMessage("Name is required"),

  body("email")
    .isEmail()
    .withMessage("Valid email is required"),

  body("password")
    .isLength({ min: 6 })
    .withMessage(
      "Password must be at least 6 characters"
    ),

  body("phoneNumber")
    .optional()
    .isString(),

  body("address")
    .optional()
    .isString(),

  body("department")
    .optional()
    .isString(),

  body("designation")
    .optional()
    .isString()
];

/* Update User Validation */
const updateUserValidation = [
  body("name")
    .optional()
    .isString(),

  body("email")
    .optional()
    .isEmail()
    .withMessage("Invalid email"),

  body("phoneNumber")
    .optional()
    .isString(),

  body("address")
    .optional()
    .isString()
];

/* Update User Status Validation */
const updateUserStatusValidation = [
  body("status")
    .notEmpty()
    .isIn([
      "ACTIVE",
      "INACTIVE",
      "SUSPENDED",
      "BLOCKED"
    ])
    .withMessage("Invalid user status")
];

module.exports = {
  createAdminValidation,
  updateUserValidation,
  updateUserStatusValidation
};