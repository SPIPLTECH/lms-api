const express = require("express");

const router = express.Router();

const controller = require("./review.controller");

const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyReviewOwnership = require("../../middleware/reviewOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { reviewCreateSchema, reviewUpdateSchema } = require("./review.validation");
router.get("/", controller.getReviews);

router.get(
  "/mine",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getMyReviews
);

router.get(
  "/course/:courseId/stats",
  controller.getCourseReviewStats
);

router.get("/:reviewId", controller.getReviewById);

router.post(
  "/",
  verifyToken,
  validate(reviewCreateSchema),
  controller.createReview
);

router.put(
  "/:reviewId",
  verifyToken,
  verifyReviewOwnership,
  validate(reviewUpdateSchema),
  controller.updateReview
);

router.delete(
  "/:reviewId",
  verifyToken,
  verifyReviewOwnership,
  controller.deleteReview
);

module.exports = router;