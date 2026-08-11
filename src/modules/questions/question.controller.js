const questionService = require("./question.service");

// =========================
// Get All Questions
// =========================
const getQuestions = async (req, res, next) => {
  try {
    const questions = await questionService.getQuestions({
      quizId: req.query.quizId,
      courseId: req.query.courseId,
      moduleId: req.query.moduleId,
    });

    res.json({
      success: true,
      data: questions,
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Get Questions By Quiz
// =========================
const getQuestionsByQuizId = async (req, res, next) => {
  const id = req.params.quizId;
  try {
    // 1. Try to fetch as single question first (compatibility fallback for /questions/:id)
    const question = await questionService.getQuestionById(id);
    return res.json({
      success: true,
      data: question,
    });
  } catch (error) {
    // 2. If it's not a question, fetch as quiz questions list
    try {
      const questions = await questionService.getQuestionsByQuizId(id);
      return res.json({
        success: true,
        data: questions,
      });
    } catch (quizError) {
      next(quizError);
    }
  }
};

// =========================
// Get Question By ID
// =========================
const getQuestionById = async (req, res, next) => {
  try {
    const question = await questionService.getQuestionById(
      req.params.questionId
    );

    res.json({
      success: true,
      data: question,
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Create Single Question
// =========================
const createQuestion = async (req, res, next) => {
  try {
    const question = await questionService.createQuestion(req.body);

    res.status(201).json({
      success: true,
      data: question,
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Bulk Create Questions
// =========================
const bulkCreateQuestions = async (req, res, next) => {
  try {
    const payload = req.body.questions || req.body;

    if (!payload || (!Array.isArray(payload) && !Array.isArray(payload.questions))) {
      return res.status(400).json({
        success: false,
        message: "questions must be an array or an object containing a questions array",
      });
    }

    const result = await questionService.bulkCreateQuestions(
      payload,
      req.body.quizId
    );

    res.status(201).json({
      success: true,
      message: "Questions created successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Import Questions
// =========================
const importQuestions = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload a file.",
      });
    }

    const quizId = req.body.quizId || req.query.quizId;
    if (!quizId) {
      return res.status(400).json({
        success: false,
        message: "quizId is required to import questions.",
      });
    }

    const result = await questionService.importQuestions(
      req.file,
      quizId
    );

    res.status(201).json({
      success: true,
      message: "Questions imported successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Update Question
// =========================
const updateQuestion = async (req, res, next) => {
  try {
    const question = await questionService.updateQuestion(
      req.params.questionId,
      req.body
    );

    res.json({
      success: true,
      data: question,
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Delete Question
// =========================
const deleteQuestion = async (req, res, next) => {
  try {
    await questionService.deleteQuestion(req.params.questionId);

    res.json({
      success: true,
      message: "Question deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getQuestions,
  getQuestionsByQuizId,
  getQuestionById,
  createQuestion,
  bulkCreateQuestions,
  importQuestions,
  updateQuestion,
  deleteQuestion,
};