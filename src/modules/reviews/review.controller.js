const prisma = require("../../config/database");
const reviewService = require("./review.service");

const getReviews = async (req, res, next) => {
  try {
    const studentId = req.query.studentId;

    const reviews = await reviewService.getReviews(
      studentId,
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

const getMyReviews = async (req, res, next) => {
  try {
    const { courseId, rating, startDate, endDate } = req.query;
    const result = await reviewService.getInstructorReviews(req.user.id, {
      courseId,
      rating,
      startDate,
      endDate
    });

    res.json({
      success: true,
      data: result
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
    const student =
      await prisma.studentProfile.findUnique({
        where: {
          userId: req.user.id
        }
      });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found"
      });
    }

    const review = await reviewService.createReview(
      req.body,
      student.id
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
    await reviewService.deleteReview(
      req.params.reviewId
    );

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
  getMyReviews,
  getReviewById,
  createReview,
  updateReview,
  deleteReview,
  getCourseReviewStats
};