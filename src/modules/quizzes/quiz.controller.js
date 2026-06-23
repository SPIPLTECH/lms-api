const quizService = require(
  "./quiz.service"
);

const getQuizzes = async (
  req,
  res,
  next
) => {
  try {
    const quizzes =
      await quizService.getQuizzes(
        req.query.courseId
      );

    res.json({
      success: true,
      data: quizzes
    });
  } catch (error) {
    next(error);
  }
};

const getQuizById = async (
  req,
  res,
  next
) => {
  try {
    const quiz =
      await quizService.getQuizById(
        req.params.quizId
      );

    res.json({
      success: true,
      data: quiz
    });
  } catch (error) {
    next(error);
  }
};

const createQuiz = async (
  req,
  res,
  next
) => {
  try {
    const quiz =
      await quizService.createQuiz(
        req.body
      );

    res.status(201).json({
      success: true,
      data: quiz
    });
  } catch (error) {
    next(error);
  }
};

const updateQuiz = async (
  req,
  res,
  next
) => {
  try {
    const quiz =
      await quizService.updateQuiz(
        req.params.quizId,
        req.body
      );

    res.json({
      success: true,
      data: quiz
    });
  } catch (error) {
    next(error);
  }
};

const deleteQuiz = async (
  req,
  res,
  next
) => {
  try {
    await quizService.deleteQuiz(
      req.params.quizId
    );

    res.json({
      success: true,
      message:
        "Quiz deleted successfully"
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz
};