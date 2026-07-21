const quizService = require(
  "./quiz.service"
);

const getQuizzes = async (
  req,
  res,
  next
) => {
  try {
    let studentId = null;
    if (req.user && req.user.role === "STUDENT") {
      const student = await require("../../config/database").studentProfile.findUnique({
        where: {
          userId: req.user.id
        }
      });
      if (student) {
        studentId = student.id;
      }
    }

    const quizzes =
      await quizService.getQuizzes(
        req.query.courseId,
        studentId
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

const submitQuiz = async (
  req,
  res,
  next
) => {
  try {
    const student = await require("../../config/database").studentProfile.findUnique({
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

    const submission = await quizService.submitQuiz(
      student.id,
      req.params.quizId,
      req.body.answers || []
    );

    res.status(201).json({
      success: true,
      data: submission
    });
  } catch (error) {
    next(error);
  }
};

const getQuizResult = async (
  req,
  res,
  next
) => {
  try {
    const student = await require("../../config/database").studentProfile.findUnique({
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

    const submission = await quizService.getQuizResult(
      student.id,
      req.params.quizId
    );

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Quiz submission not found"
      });
    }

    res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    next(error);
  }
};

const generateSelfAssessmentQuiz = async (req, res, next) => {
  try {
    const { courseId, questionCount } = req.body;
    if (!courseId) {
      return res.status(400).json({
        success: false,
        message: "courseId is required"
      });
    }

    const quiz = await quizService.generateSelfAssessmentQuiz(
      courseId,
      questionCount ? parseInt(questionCount, 10) : 5
    );

    res.status(201).json({
      success: true,
      data: quiz
    });
  } catch (error) {
    if (error.message.includes("No questions found")) {
      return res.status(404).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

module.exports = {
  getQuizzes,
  getQuizById,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  submitQuiz,
  getQuizResult,
  generateSelfAssessmentQuiz
};