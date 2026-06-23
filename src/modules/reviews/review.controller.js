const reviewService = require("./review.service");

const getReviews = async (req, res, next) => {
  try {
    const reviews = await reviewService.getReviews(
      req.query.userId,
      req.query.courseId
    );

    res.json({
      success: true,
      data: reviews
    });
  } catch (error) {
    next(error);
  }
};

const getReviewById = async (req, res, next) => {
  try {
    const review = await reviewService.getReviewById(
      req.params.reviewId
    );

    if (!review) {
      return res.status(404).json({
        success: false,
        message: "Review not found"
      });
    }

    res.json({
      success: true,
      data: review
    });
  } catch (error) {
    next(error);
  }
};
const getCourseReviewStats = async (
  req,
  res,
  next
) => {
  try {
    const stats =
      await reviewService.getCourseReviewStats(
        req.params.courseId
      );

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
};
const createReview = async (req, res, next) => {
  try {
    const review = await reviewService.createReview(
      req.body,
      req.user.id
    );

    res.status(201).json({
      success: true,
      data: review
    });
  } catch (error) {
    next(error);
  }
};

const updateReview = async (req, res, next) => {
  try {
    const review = await reviewService.updateReview(
      req.params.reviewId,
      req.body
    );

    res.json({
      success: true,
      message: "Review updated successfully",
      data: review
    });
  } catch (error) {
    next(error);
  }
};

const deleteReview = async (req, res, next) => {
  try {
    await reviewService.deleteReview(req.params.reviewId);

    res.json({
      success: true,
      message: "Review deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getReviews,
  getReviewById,
  createReview,
  updateReview,
  deleteReview,
  getCourseReviewStats
};