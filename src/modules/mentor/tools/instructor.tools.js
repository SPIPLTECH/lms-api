const dashboardService = require("../../dashboard/dashboard.service");
const resultsService = require("../../results/results.service");
const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Helper to verify instructor owns course (or user is ADMIN)
 */
const verifyCourseOwnership = async (reqUser, courseId) => {
  if (!courseId) return;
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, creatorId: true, title: true },
  });

  if (!course) {
    throw new ApiError(404, `Course with ID '${courseId}' not found`);
  }

  if (reqUser.role !== "ADMIN" && course.creatorId !== reqUser.id) {
    throw new ApiError(403, `Access denied: You do not own course '${course.title || courseId}'`);
  }
};

/**
 * Instructor Tool 1: Get Instructor Analytics
 */
const getMyInstructorAnalyticsTool = {
  name: "getMyInstructorAnalytics",
  allowedRoles: ["INSTRUCTOR", "ADMIN"],
  inputSchema: { courseId: "string optional" },
  authorize: async (reqUser, params = {}) => {
    if (!reqUser || !["INSTRUCTOR", "ADMIN"].includes(reqUser.role)) {
      throw new ApiError(403, "Forbidden: Only instructors and admins can access instructor analytics");
    }
    if (params.courseId) {
      await verifyCourseOwnership(reqUser, params.courseId);
    }
  },
  execute: async (reqUser, params = {}) => {
    const data = await dashboardService.getInstructorDashboard(reqUser.id, params.courseId);
    return {
      coursesCount: data.targetCourses ? data.targetCourses.length : 0,
      totalStudentsEnrolled: data.totalStudentsEnrolled || 0,
      inactiveStudentsCount: data.inactiveStudentsCount || 0,
      coursesSummary: (data.targetCourses || []).map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
      })),
      priorities: data.priorities || [],
    };
  },
};

/**
 * Instructor Tool 2: Get Course Results Analytics
 */
const getCourseResultsAnalyticsTool = {
  name: "getCourseResultsAnalytics",
  allowedRoles: ["INSTRUCTOR", "ADMIN"],
  inputSchema: { courseId: "string optional", quizId: "string optional" },
  authorize: async (reqUser, params = {}) => {
    if (!reqUser || !["INSTRUCTOR", "ADMIN"].includes(reqUser.role)) {
      throw new ApiError(403, "Forbidden: Only instructors and admins can access course results");
    }
    if (params.courseId) {
      await verifyCourseOwnership(reqUser, params.courseId);
    }
  },
  execute: async (reqUser, params = {}) => {
    const results = await resultsService.getResults(reqUser.id, {
      courseId: params.courseId,
      quizId: params.quizId,
    });

    return {
      totalSubmissions: results.stats?.totalSubmissions || results.submissions?.length || 0,
      averageScore: results.stats?.averageScore || 0,
      passPercentage: results.stats?.passPercentage || 0,
      quizzesCount: results.quizzes ? results.quizzes.length : 0,
    };
  },
};

/**
 * Instructor Tool 3: Get Course Students
 */
const getCourseStudentsTool = {
  name: "getCourseStudents",
  allowedRoles: ["INSTRUCTOR", "ADMIN"],
  inputSchema: { courseId: "string required" },
  authorize: async (reqUser, params = {}) => {
    if (!reqUser || !["INSTRUCTOR", "ADMIN"].includes(reqUser.role)) {
      throw new ApiError(403, "Forbidden: Only instructors and admins can access course students");
    }
    if (!params.courseId) {
      throw new ApiError(400, "courseId is required to retrieve course students");
    }
    await verifyCourseOwnership(reqUser, params.courseId);
  },
  execute: async (reqUser, params) => {
    const enrollments = await prisma.enrollment.findMany({
      where: { courseId: params.courseId },
      select: {
        enrolledAt: true,
        student: {
          select: {
            id: true,
            user: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      take: 50,
    });

    const students = enrollments.map((e) => ({
      studentId: e.student.id,
      name: e.student.user?.name || "Student",
      enrolledAt: e.enrolledAt,
    }));

    return {
      courseId: params.courseId,
      totalEnrolledInSample: students.length,
      students,
    };
  },
};

module.exports = {
  getMyInstructorAnalyticsTool,
  getCourseResultsAnalyticsTool,
  getCourseStudentsTool,
};
