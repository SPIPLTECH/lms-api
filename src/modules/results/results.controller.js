const resultsService = require("./results.service");

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
  getFinalTestOverview
};
