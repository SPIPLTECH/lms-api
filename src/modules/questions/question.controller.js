const questionService = require("./question.service");
const questionRepositoryService = require("./services/questionRepository.service");

// =========================
// Get Repository Questions (Paginated & Filtered)
// =========================
const getQuestions = async (req, res, next) => {
  try {
    // If specifically querying by quizId legacy format
    if (req.query.quizId) {
      const questions = await questionService.getQuestions(req.query.quizId);
      return res.json({
        success: true,
        data: questions,
      });
    }

    const user = req.user || { role: "GUEST" };
    const result = await questionRepositoryService.getQuestions(req.query, user);

    res.json({
      success: true,
      data: result.data,
      pagination: result.pagination,
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
    const question = await questionRepositoryService.getQuestionById(id, req.user || {});
    if (question) {
      return res.json({
        success: true,
        data: question,
      });
    }
  } catch (error) {
    // Fallback to quiz questions list
  }

  try {
    const questions = await questionService.getQuestionsByQuizId(id);
    return res.json({
      success: true,
      data: questions,
    });
  } catch (quizError) {
    next(quizError);
  }
};

// =========================
// Get Question By ID
// =========================
const getQuestionById = async (req, res, next) => {
  try {
    const question = await questionRepositoryService.getQuestionById(
      req.params.questionId,
      req.user || {}
    );

    if (!question) {
      return res.status(404).json({
        success: false,
        message: "Question not found",
      });
    }

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
    const userId = req.user ? req.user.id : null;

    // Repository creation
    const question = await questionRepositoryService.createQuestion(req.body, userId);

    res.status(201).json({
      success: true,
      data: question,
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Bulk Upload Questions (Excel, CSV, JSON)
// =========================
const uploadQuestions = async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: "Please upload an Excel (.xlsx), CSV (.csv), or JSON (.json) file.",
      });
    }

    const userId = req.user ? req.user.id : null;
    const result = await questionRepositoryService.bulkUploadQuestions(
      req.file.buffer,
      req.file.originalname,
      userId
    );

    res.status(201).json({
      success: true,
      message: `Processed ${result.total} questions. Successfully imported ${result.importedCount}.`,
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
    const question = await questionRepositoryService.updateQuestion(
      req.params.questionId,
      req.body,
      req.user || {}
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
    await questionRepositoryService.deleteQuestion(
      req.params.questionId,
      req.user || {}
    );

    res.json({
      success: true,
      message: "Question deleted or archived successfully",
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Archive Question
// =========================
const archiveQuestion = async (req, res, next) => {
  try {
    const question = await questionRepositoryService.archiveQuestion(
      req.params.questionId,
      req.user || {}
    );

    res.json({
      success: true,
      message: "Question archived successfully",
      data: question,
    });
  } catch (error) {
    next(error);
  }
};

// =========================
// Duplicate Question
// =========================
const duplicateQuestion = async (req, res, next) => {
  try {
    const question = await questionRepositoryService.duplicateQuestion(
      req.params.questionId,
      req.user || {}
    );

    res.status(201).json({
      success: true,
      message: "Question duplicated successfully",
      data: question,
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
  uploadQuestions,
  updateQuestion,
  deleteQuestion,
  archiveQuestion,
  duplicateQuestion,
};