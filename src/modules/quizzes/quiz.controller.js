const quizService = require("./quiz.service");
const quizImportService = require("./services/quizImport.service");
const testReviewService = require("./testReview.service");

const getQuizzes = async (req, res, next) => {
  try {
    let studentId = null;
    if (req.user && req.user.role === "STUDENT") {
      const student = await require("../../config/database").studentProfile.findUnique({
        where: {
          userId: req.user.id,
        },
      });
      if (student) {
        studentId = student.id;
      }
    }

    const quizzes = await quizService.getQuizzes(
      req.query.courseId,
      req.user?.role,
      req.user?.id,
      studentId
    );

    res.json({
      success: true,
      data: quizzes,
    });
  } catch (error) {
    next(error);
  }
};

const getQuizById = async (req, res, next) => {
  try {
    // A student also gets their attempt allowance, so the attempt UI can
    // refuse to start a quiz the server would refuse to accept.
    let studentId = null;
    if (req.user?.role === "STUDENT") {
      const student = await require("../../config/database").studentProfile.findUnique({
        where: { userId: req.user.id },
      });
      studentId = student?.id ?? null;
      await quizService.assertStudentQuizAccess(studentId, req.params.quizId);
    } else if (req.user?.role === "INSTRUCTOR") {
      await quizService.assertInstructorQuizOwnership(req.user.id, req.params.quizId);
    }

    const quiz = await quizService.getQuizById(req.params.quizId, req.user?.role, studentId);

    if (!quiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }

    res.json({
      success: true,
      data: quiz,
    });
  } catch (error) {
    next(error);
  }
};

const createQuiz = async (req, res, next) => {
  try {
    const quiz = await quizService.createQuiz(req.body, req.user?.id || null);

    res.status(201).json({
      success: true,
      data: quiz,
    });
  } catch (error) {
    next(error);
  }
};

const updateQuiz = async (req, res, next) => {
  try {
    const quiz = await quizService.updateQuiz(req.params.quizId, req.body, req.user?.id || null);

    res.json({
      success: true,
      data: quiz,
    });
  } catch (error) {
    next(error);
  }
};

const deleteQuiz = async (req, res, next) => {
  try {
    await quizService.deleteQuiz(req.params.quizId);

    res.json({
      success: true,
      message: "Quiz deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

const submitQuiz = async (req, res, next) => {
  try {
    const student = await require("../../config/database").studentProfile.findUnique({
      where: {
        userId: req.user.id,
      },
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found",
      });
    }

    await quizService.assertStudentQuizAccess(student.id, req.params.quizId);

    const submission = await quizService.submitQuiz(
      student.id,
      req.params.quizId,
      req.body.answers || [],
      req.body.timeTakenSeconds ?? null,
      // Per-question visit/skip/hint activity from the attempt UI. Optional:
      // an older client sends only `answers` and still submits.
      req.body.questionStates || []
    );

    res.status(201).json({
      success: true,
      data: submission,
    });
  } catch (error) {
    next(error);
  }
};

const getQuizResult = async (req, res, next) => {
  try {
    const student = await require("../../config/database").studentProfile.findUnique({
      where: {
        userId: req.user.id,
      },
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found",
      });
    }

    // Verify the quiz exists and the student is enrolled in its course before returning results.
    const prisma = require("../../config/database");
    const targetQuiz = await prisma.quiz.findUnique({
      where: { id: req.params.quizId },
      select: { id: true, courseId: true },
    });
    if (!targetQuiz) {
      return res.status(404).json({
        success: false,
        message: "Quiz not found",
      });
    }
    const enrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_courseId: { studentId: student.id, courseId: targetQuiz.courseId },
      },
      select: { id: true },
    });
    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: you are not enrolled in this course",
      });
    }

    // ?attempt=<id> opens one specific earlier attempt; without it, the latest.
    const submission = await quizService.getQuizResult(
      student.id,
      req.params.quizId,
      typeof req.query.attempt === "string" ? req.query.attempt : null
    );

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: "Quiz submission not found",
      });
    }

    res.json({
      success: true,
      data: submission,
    });
  } catch (error) {
    next(error);
  }
};

const getMyQuizSubmissions = async (req, res, next) => {
  try {
    const student = await require("../../config/database").studentProfile.findUnique({
      where: {
        userId: req.user.id,
      },
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found",
      });
    }

    const submissions = await quizService.getMyQuizSubmissions(student.id);

    res.json({
      success: true,
      data: submissions,
    });
  } catch (error) {
    next(error);
  }
};

// The signed-in student's test-series review for a course they are enrolled
// in: progress until every Final quiz is submitted, then the full review.
// data is null for a course without the review switched on.
const getCourseTestReview = async (req, res, next) => {
  try {
    const prisma = require("../../config/database");
    const student = await prisma.studentProfile.findUnique({
      where: { userId: req.user.id },
    });

    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found",
      });
    }

    const enrollment = await prisma.enrollment.findFirst({
      where: { studentId: student.id, courseId: req.params.courseId },
      select: { id: true },
    });

    if (!enrollment) {
      return res.status(403).json({
        success: false,
        message: "You are not enrolled in this course",
      });
    }

    const review = await testReviewService.getCourseTestReview(student.id, req.params.courseId);

    res.json({
      success: true,
      data: review,
    });
  } catch (error) {
    next(error);
  }
};

// =====================================
// Import Repository Questions to Quiz
// =====================================
const importQuestionsToQuiz = async (req, res, next) => {
  try {
    const quizId = req.params.quizId;
    const { questionIds } = req.body;

    const result = await quizImportService.importQuestionsToQuiz(
      quizId,
      questionIds,
      req.user
    );

    res.status(201).json({
      success: true,
      message: result.message,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const removeQuestionFromQuiz = async (req, res, next) => {
  try {
    const { quizId, questionId } = req.params;
    const result = await quizImportService.removeQuestionFromQuiz(quizId, questionId);

    res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

const reorderQuizQuestions = async (req, res, next) => {
  try {
    const quizId = req.params.quizId;
    const { orderedQuestionIds } = req.body;

    const result = await quizImportService.reorderQuizQuestions(quizId, orderedQuestionIds);

    res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

const updateQuizQuestionMarks = async (req, res, next) => {
  try {
    const { quizId, questionId } = req.params;
    const { marks } = req.body;

    const result = await quizImportService.updateQuizQuestionMarks(quizId, questionId, marks);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const generateSelfAssessmentQuiz = async (req, res, next) => {
  try {
    const { courseId, questionCount } = req.body;
    const student = await require("../../config/database").studentProfile.findUnique({
      where: { userId: req.user.id },
    });
    if (!student) {
      return res.status(404).json({
        success: false,
        message: "Student profile not found",
      });
    }
    await quizService.assertStudentCourseAccess(student.id, courseId);
    const quiz = await quizService.generateSelfAssessmentQuiz(courseId, questionCount);

    res.status(201).json({
      success: true,
      data: quiz,
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
  deleteQuiz,
  submitQuiz,
  getQuizResult,
  getMyQuizSubmissions,
  getCourseTestReview,
  generateSelfAssessmentQuiz,
  importQuestionsToQuiz,
  removeQuestionFromQuiz,
  reorderQuizQuestions,
  updateQuizQuestionMarks,
};