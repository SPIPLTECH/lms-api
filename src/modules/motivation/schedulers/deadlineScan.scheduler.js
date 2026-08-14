const cron = require("node-cron");

const prisma = require("../../../config/database");
const motivationService = require("../services/motivation.service");
const { DEADLINE_LOOKAHEAD_HOURS } = require("../constants");

const CRON_EXPRESSION = "*/30 * * * *"; // every 30 minutes
const HOUR_MS = 3600 * 1000;

/**
 * Covers the "Deadline Approaching" business trigger — no Observation
 * EventType exists for a deadline nearing, so this scans real Quiz/
 * Assignment dueDate columns directly and regenerates motivation state
 * (deadlineAlert.detector.js picks it up) for every enrolled-but-not-yet-
 * submitted student, same idea as Recommendation's own deadline scan.
 */
const findStudentsWithUpcomingDeadlines = async (now) => {
  const windowEnd = new Date(now.getTime() + DEADLINE_LOOKAHEAD_HOURS * HOUR_MS);

  const [quizzes, assignments] = await Promise.all([
    prisma.quiz.findMany({ where: { dueDate: { gte: now, lte: windowEnd }, isPublished: true }, select: { courseId: true } }),
    prisma.assignment.findMany({ where: { dueDate: { gte: now, lte: windowEnd }, isPublished: true }, select: { courseId: true } }),
  ]);

  const courseIds = [...new Set([...quizzes, ...assignments].map((row) => row.courseId))];
  if (courseIds.length === 0) return [];

  const enrollments = await prisma.enrollment.findMany({
    where: { courseId: { in: courseIds } },
    select: { studentId: true },
    distinct: ["studentId"],
  });

  return enrollments.map((e) => e.studentId);
};

const runOnce = async () => {
  const now = new Date();
  const studentIds = await findStudentsWithUpcomingDeadlines(now);

  let succeeded = 0;
  for (const studentId of studentIds) {
    try {
      await motivationService.generateForStudent(studentId, "deadline-scan");
      succeeded += 1;
    } catch (error) {
      console.error(`[motivation:deadlineScan] failed to regenerate for ${studentId}:`, error.message);
    }
  }

  console.log(`[motivation:deadlineScan] regenerated ${succeeded}/${studentIds.length} students`);
  return { succeeded, total: studentIds.length };
};

const start = () => {
  cron.schedule(CRON_EXPRESSION, () => {
    runOnce().catch((error) => {
      console.error("[motivation:deadlineScan] run failed:", error);
    });
  });

  console.log(`[motivation:deadlineScan] scheduled (${CRON_EXPRESSION})`);
};

module.exports = { start, runOnce };
