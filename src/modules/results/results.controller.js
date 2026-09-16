const resultsService = require("./results.service");

const getResults = async (req, res, next) => {
  try {
    const { courseId, batchId, quizId, assignmentId, examId, studentId, startDate, endDate, quizTag } = req.query;
    const results = await resultsService.getResults(req.user.id, {
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

/** One row per Final test with its roster — powers the instructor overview. */
const getFinalTestOverview = async (req, res, next) => {
  try {
    const { courseId, quizId } = req.query;
    const tests = await resultsService.getFinalTestOverview(req.user.id, { courseId, quizId });

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
  getFinalTestOverview
};
