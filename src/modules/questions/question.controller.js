const questionService = require(
  "./question.service"
);

const getQuestions = async (
  req,
  res,
  next
) => {
  try {
    const questions =
      await questionService.getQuestions(
        req.query.quizId
      );

    res.json({
      success: true,
      data: questions
    });
  } catch (error) {
    next(error);
  }
};

const getQuestionById = async (
  req,
  res,
  next
) => {
  try {
    const question =
      await questionService.getQuestionById(
        req.params.questionId
      );

    res.json({
      success: true,
      data: question
    });
  } catch (error) {
    next(error);
  }
};

const createQuestion = async (
  req,
  res,
  next
) => {
  try {
    const question =
      await questionService.createQuestion(
        req.body
      );

    res.status(201).json({
      success: true,
      data: question
    });
  } catch (error) {
    next(error);
  }
};

const updateQuestion = async (
  req,
  res,
  next
) => {
  try {
    const question =
      await questionService.updateQuestion(
        req.params.questionId,
        req.body
      );

    res.json({
      success: true,
      data: question
    });
  } catch (error) {
    next(error);
  }
};

const deleteQuestion = async (
  req,
  res,
  next
) => {
  try {
    await questionService.deleteQuestion(
      req.params.questionId
    );

    res.json({
      success: true,
      message:
        "Question deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getQuestions,
  getQuestionById,
  createQuestion,
  updateQuestion,
  deleteQuestion
};