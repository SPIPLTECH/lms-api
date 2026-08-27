const prisma = require("../../../config/database");

const findByStudent = (studentId, { courseId } = {}, client = prisma) =>
  client.learningMilestone.findMany({
    where: { studentId, courseId: courseId || undefined },
    orderBy: [{ status: "asc" }, { targetDate: "asc" }],
  });

/** Upserted, never deleted — achieved milestones are the agent's own append-only historical progress record. */
const upsertCandidate = (studentId, courseId, milestone, client = prisma) =>
  client.learningMilestone.upsert({
    where: { studentId_courseId_milestoneKey: { studentId, courseId, milestoneKey: milestone.milestoneKey } },
    create: {
      studentId,
      courseId,
      milestoneType: milestone.milestoneType,
      milestoneKey: milestone.milestoneKey,
      moduleId: milestone.moduleId || null,
      title: milestone.title,
      status: milestone.status,
      targetDate: milestone.targetDate || null,
      achievedAt: milestone.achievedAt || null,
      version: 1,
    },
    update: {
      title: milestone.title,
      status: milestone.status,
      targetDate: milestone.targetDate || null,
      achievedAt: milestone.achievedAt || null,
      version: { increment: 1 },
    },
  });

module.exports = { findByStudent, upsertCandidate };
