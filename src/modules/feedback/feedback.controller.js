const feedbackService = require("./feedback.service");
const { submitFeedbackSchema } = require("./feedback.validation");
const ApiError = require("../../utils/ApiError");

const submitFeedback = async (req, res, next) => {
  try {
    const courseId = req.params.courseId || req.body.courseId;
    if (!courseId) {
      return next(new ApiError(400, "courseId is required"));
    }

    const { error, value } = submitFeedbackSchema.validate(
      { ...req.body, courseId },
      { abortEarly: false }
    );

    if (error) {
      return next(new ApiError(400, error.details.map((d) => d.message).join(", ")));
    }

    const feedback = await feedbackService.submitFeedback(
      req.user.id,
      courseId,
      value
    );

    res.status(201).json({
      success: true,
      data: feedback,
      message: "Feedback submitted successfully",
    });
  } catch (error) {
    next(error);
  }
};

const getMyFeedback = async (req, res, next) => {
  try {
    const courseId = req.params.courseId || req.query.courseId;
    if (!courseId) {
      return next(new ApiError(400, "courseId is required"));
    }

    const result = await feedbackService.getMyFeedback(req.user.id, courseId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getCourseFeedback = async (req, res, next) => {
  try {
    const courseId = req.params.courseId || req.query.courseId;
    if (!courseId) {
      return next(new ApiError(400, "courseId is required"));
    }

    const result = await feedbackService.getCourseFeedback(req.user, courseId);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  submitFeedback,
  getMyFeedback,
  getCourseFeedback,
};
