const dashboardService = require("../../dashboard/dashboard.service");
const learnerModelService = require("../../learner-model/learnerModel.service");
const quizService = require("../../quizzes/quiz.service");
const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Student Tool 1: Get Dashboard Summary
 */
const getMyDashboardSummaryTool = {
  name: "getMyDashboardSummary",
  allowedRoles: ["STUDENT"],
  inputSchema: {},
  authorize: async (reqUser) => {
    if (!reqUser || reqUser.role !== "STUDENT") {
      throw new ApiError(403, "Forbidden: Only students can access student dashboard summary");
    }
  },
  execute: async (reqUser) => {
    const dashboard = await dashboardService.getStudentDashboard(reqUser.id);
    const stats = dashboard.stats || {};

    // completedQuizzes counts actual quiz submissions -- distinguishes
    // "no quiz attempts yet" from a genuine 0% score/passing rate.
    const hasQuizAttempts = (stats.completedQuizzes || 0) > 0;
    const quizStatus = hasQuizAttempts
      ? {
          status: "RECORDED",
          averageScore: stats.avgQuizScore || 0,
          passingRate: stats.passingRate || 0,
        }
      : {
          status: "NO_ATTEMPTS",
        };

    return {
      enrolledCourses: stats.enrolledCourses || 0,
      completedLessons: stats.completedLessons || 0,
      totalLessons: stats.totalLessons || 0,
      completionRate: stats.completionRate || 0,
      streak: stats.streak || 0,
      courseProgress: (dashboard.enrolledCoursesList || []).map((c) => ({
        title: c.course?.title,
        progress: c.progress,
      })),
      quizStatus,
    };
  },
};

/**
 * Student Tool 2: Get Learner State
 */
const getMyLearnerStateTool = {
  name: "getMyLearnerState",
  allowedRoles: ["STUDENT"],
  inputSchema: { kc: "string optional" },
  authorize: async (reqUser) => {
    if (!reqUser || reqUser.role !== "STUDENT") {
      throw new ApiError(403, "Forbidden: Only students can access student learner state");
    }
  },
  execute: async (reqUser, params = {}) => {
    // Calling learnerModelService with callingUser enforces student profile isolation
    const state = await learnerModelService.getLearnerState({ callingUser: reqUser });

    // Format output following no-metric-leakage rules:
    // Convert raw probabilities/internal codes into human-readable learning statuses
    let knowledgeState = (state.knowledgeState || []).map((ks) => {
      let statusLabel = "In Progress";
      if (ks.masteryProbability >= 0.85) statusLabel = "Mastered";
      else if (ks.masteryProbability <= 0.4) statusLabel = "Needs Review";

      return {
        concept: ks.kc,
        status: statusLabel,
        attempts: ks.attemptsCount,
      };
    });

    if (params.kc) {
      knowledgeState = knowledgeState.filter((ks) =>
        ks.concept.toLowerCase().includes(params.kc.toLowerCase())
      );
    }

    const activeGaps = (state.misconceptionState || [])
      .filter((gap) => gap.status === "ACTIVE")
      .map((gap) => ({
        topic: gap.concept,
        description: gap.description || "Area needing additional practice",
      }));

    return {
      learningGoals: state.learningContext?.learningGoals || null,
      focusTopics: state.learningContext?.focusTopics || null,
      conceptsState: knowledgeState,
      activeKnowledgeGaps: activeGaps,
    };
  },
};

/**
 * Student Tool 3: Get Quiz Result
 */
const getMyQuizResultTool = {
  name: "getMyQuizResult",
  allowedRoles: ["STUDENT"],
  inputSchema: { quizId: "string required" },
  authorize: async (reqUser, params = {}) => {
    if (!reqUser || reqUser.role !== "STUDENT") {
      throw new ApiError(403, "Forbidden: Only students can access quiz results");
    }
    if (!params.quizId) {
      throw new ApiError(400, "quizId is required to retrieve quiz result");
    }
  },
  execute: async (reqUser, params) => {
    const studentProfile = await prisma.studentProfile.findUnique({
      where: { userId: reqUser.id },
    });

    if (!studentProfile) {
      throw new ApiError(404, "Student profile not found");
    }

    const result = await quizService.getQuizResult(studentProfile.id, params.quizId);

    if (!result) {
      return {
        found: false,
        message: "No submission found for this quiz.",
      };
    }

    return {
      found: true,
      quizTitle: result.quizTitle || result.title,
      score: result.score,
      totalMarks: result.totalMarks,
      percentage: result.percentage,
      passed: result.passed,
      submittedAt: result.submittedAt,
    };
  },
};

module.exports = {
  getMyDashboardSummaryTool,
  getMyLearnerStateTool,
  getMyQuizResultTool,
};
