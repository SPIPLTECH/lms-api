const resultsService = require("./results.service");
const quizAnalyticsService = require("./quizAnalytics.service");

const getResults = async (req, res, next) => {
  try {
    const { courseId, batchId, quizId, assignmentId, examId, studentId, startDate, endDate, quizTag } = req.query;
    const results = await resultsService.getResults(req.user, {
      courseId,
      batchId,
      quizId,
      assignmentId,
      examId,
      studentId,
      startDate,
      endDate,
      quizTag
    });

    res.json({
      success: true,
      data: results
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /results/quiz-analytics?quizId=<id>
 *
 * Quiz- and question-level analytics for one quiz. A query parameter rather
 * than a nested path: this is a view over a quiz, not a sub-resource of it,
 * and it keeps the results resource flat.
 *
 * Distinct from GET /results, which lists submissions across many quizzes —
 * this aggregates one quiz in depth, so neither duplicates the other.
 */
const getQuizAnalytics = async (req, res, next) => {
  try {
    const analytics = await quizAnalyticsService.getQuizAnalytics(req.user, {
      quizId: req.query.quizId
    });

    // A quiz outside this instructor's courses is reported as missing rather
    // than forbidden — confirming it exists would itself leak.
    if (!analytics) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found"
      });
    }

    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    next(error);
  }
};

/** One row per Final test with its roster — powers the instructor overview. */
const getFinalTestOverview = async (req, res, next) => {
  try {
    const { courseId, quizId } = req.query;
    const tests = await resultsService.getFinalTestOverview(req.user, { courseId, quizId });

    res.json({
      success: true,
      data: tests
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getResults,
  getQuizAnalytics,
  getFinalTestOverview
};
