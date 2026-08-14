const dashboardService = require("../../dashboard/dashboard.service");
const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

/**
 * Admin Tool 1: Get Platform Overview
 */
const getPlatformOverviewTool = {
  name: "getPlatformOverview",
  allowedRoles: ["ADMIN"],
  inputSchema: {},
  authorize: async (reqUser) => {
    if (!reqUser || reqUser.role !== "ADMIN") {
      throw new ApiError(403, "Access denied: Only platform admins can access platform overview");
    }
  },
  execute: async () => {
    const adminDash = await dashboardService.getAdminDashboard();
    return {
      totalUsers: adminDash.totalUsers,
      totalStudents: adminDash.totalStudents,
      totalInstructors: adminDash.totalInstructors,
      activeUsers: adminDash.activeUsers,
      blockedUsers: adminDash.blockedUsers,
      totalCourses: adminDash.totalCourses,
      publishedCourses: adminDash.publishedCourses,
      draftCourses: adminDash.draftCourses,
      totalEnrollments: adminDash.totalEnrollments,
    };
  },
};

/**
 * Admin Tool 2: Get Platform Users Summary
 */
const getPlatformUsersSummaryTool = {
  name: "getPlatformUsersSummary",
  allowedRoles: ["ADMIN"],
  inputSchema: {},
  authorize: async (reqUser) => {
    if (!reqUser || reqUser.role !== "ADMIN") {
      throw new ApiError(403, "Access denied: Only platform admins can access user summaries");
    }
  },
  execute: async () => {
    const totalUsers = await prisma.user.count();
    const studentsCount = await prisma.user.count({ where: { role: "STUDENT" } });
    const instructorsCount = await prisma.user.count({ where: { role: "INSTRUCTOR" } });
    const adminCount = await prisma.user.count({ where: { role: "ADMIN" } });
    const activeCount = await prisma.user.count({ where: { status: "ACTIVE" } });
    const blockedCount = await prisma.user.count({ where: { status: "BLOCKED" } });

    return {
      totalUsers,
      studentsCount,
      instructorsCount,
      adminCount,
      activeCount,
      blockedCount,
    };
  },
};

/**
 * Admin Tool 3: Get Platform Course Summary
 */
const getPlatformCourseSummaryTool = {
  name: "getPlatformCourseSummary",
  allowedRoles: ["ADMIN"],
  inputSchema: {},
  authorize: async (reqUser) => {
    if (!reqUser || reqUser.role !== "ADMIN") {
      throw new ApiError(403, "Access denied: Only platform admins can access course summaries");
    }
  },
  execute: async () => {
    const totalCourses = await prisma.course.count();
    const publishedCount = await prisma.course.count({ where: { status: "PUBLISHED" } });
    const draftCount = await prisma.course.count({ where: { status: "DRAFT" } });
    const totalEnrollments = await prisma.enrollment.count();

    return {
      totalCourses,
      publishedCount,
      draftCount,
      totalEnrollments,
    };
  },
};

module.exports = {
  getPlatformOverviewTool,
  getPlatformUsersSummaryTool,
  getPlatformCourseSummaryTool,
};
