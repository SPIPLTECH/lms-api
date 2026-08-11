const prisma = require("../../../config/database");
const { LEARNING_GOAL_STATUS } = require("../constants");

/** Read-only from this agent's own generation pipeline — see schema.prisma's LearningGoal doc comment for why there's no write path in this build. */
const findActiveByStudentAndCourse = (studentId, courseId, client = prisma) =>
  client.learningGoal.findFirst({ where: { studentId, courseId, status: LEARNING_GOAL_STATUS.ACTIVE }, orderBy: { createdAt: "desc" } });

module.exports = { findActiveByStudentAndCourse };
