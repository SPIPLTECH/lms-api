const express = require("express");
const { body } = require("express-validator");

const router = express.Router();

const controller = require("./review.controller");

const verifyToken = require("../../middleware/auth.middleware");
const verifyReviewOwnership = require("../../middleware/reviewOwnership.middleware");
const validateRequest = require("../../middleware/validation.middleware");

const reviewCreateValidation = [
  body("rating")
    .isInt({ min: 1, max: 5 })
    .withMessage("Rating must be an integer between 1 and 5")
    .toInt(),
  body("review")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 })
    .withMessage("Review must be 1000 characters or less"),
  validateRequest
];

const reviewUpdateValidation = [
  body("rating")
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage("Rating must be an integer between 1 and 5")
    .toInt(),
  body("courseId")
    .optional()
    .trim()
    .notEmpty()
    .withMessage("Course ID is required"),
  body("review")
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 1000 })
    .withMessage("Review must be 1000 characters or less"),
  validateRequest
];


router.get("/", controller.getReviews);

router.get(
  "/course/:courseId/stats",
  controller.getCourseReviewStats
);

router.get("/:reviewId", controller.getReviewById);

router.post(
  "/",
  verifyToken,
  reviewCreateValidation,
  controller.createReview
);

router.put(
  "/:reviewId",
  verifyToken,
  verifyReviewOwnership,
  reviewUpdateValidation,
  controller.updateReview
);

router.delete(
  "/:reviewId",
  verifyToken,
  verifyReviewOwnership,
  controller.deleteReview
);

module.exports = router;