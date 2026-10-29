const prisma = require("../../config/database");
const engine = require("./analytics.engine");
const learningHealth = require("../learning-health");

/**
 * Analytics agent — adaptive Phase 5.
 *
 * Daily snapshots of course and platform metrics (AnalyticsSnapshot), so
 * trends exist: today's numbers next to the last 30 days'. "Aggregates the
 * aggregators" as the original did — learner activity and risk come from
 * Learning Health's getters, never its tables; the rest from the LMS's own
 * enrolment, quiz and AI-assistant tables. Every course is computed with
 * grouped queries, so the cost does not grow with the number of courses.
 */

const DAY_MS = 86_400_000;
const PLATFORM_SCOPE_ID = "platform";
const TREND_DAYS = 30;
const WRITE_CHUNK = 50;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const utcDay = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const toMap = (rows, key, value) => new Map(rows.map((r) => [r[key], value(r)]));

/** Computes and stores today's snapshot for every course and the platform. */
async function computeSnapshots({ now = new Date() } = {}) {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);

  const [courses, enrollAgg, completionAgg, newAgg, quizRows, health, usersByRole, enrollmentCount, newEnrollments7d, completions30d, aiMessages7d, learners] =
    await Promise.all([
      prisma.course.findMany({
        where: { OR: [{ status: "PUBLISHED" }, { enrollments: { some: {} } }] },
        select: { id: true, title: true, status: true, category: true, creatorId: true, createdAt: true },
      }),
      prisma.enrollment.groupBy({ by: ["courseId"], _count: { _all: true }, _avg: { progressPercent: true } }),
      prisma.enrollment.groupBy({ by: ["courseId"], where: { completed: true }, _count: { _all: true } }),
      prisma.enrollment.groupBy({ by: ["courseId"], where: { enrolledAt: { gte: weekAgo } }, _count: { _all: true } }),
      prisma.$queryRaw`
        SELECT q."courseId" AS "courseId", AVG(a."percentage")::float AS "avg"
        FROM "QuizAttempt" a JOIN "Quiz" q ON q."id" = a."quizId"
        WHERE a."submittedAt" >= ${monthAgo}
        GROUP BY q."courseId"`,
      learningHealth.getCourseAggregates(),
      prisma.user.groupBy({ by: ["role"], _count: { _all: true } }),
      prisma.enrollment.count(),
      prisma.enrollment.count({ where: { enrolledAt: { gte: weekAgo } } }),
      prisma.enrollment.count({ where: { completed: true, completedAt: { gte: monthAgo } } }),
      prisma.aiMessage.count({ where: { role: "USER", createdAt: { gte: weekAgo } } }),
      learningHealth.getPlatformAggregates(),
    ]);

  const courseRows = engine.buildCourseMetrics({
    courses,
    enrollments: toMap(enrollAgg, "courseId", (r) => ({ count: r._count._all, avgProgress: r._avg.progressPercent })),
    completions: toMap(completionAgg, "courseId", (r) => r._count._all),
    newEnrollments: toMap(newAgg, "courseId", (r) => r._count._all),
    quizAverages: toMap(quizRows, "courseId", (r) => r.avg),
    health,
  });

  const platform = engine.buildPlatformMetrics({
    usersByRole: Object.fromEntries(usersByRole.map((r) => [r.role, r._count._all])),
    publishedCourses: courses.filter((c) => c.status === "PUBLISHED").length,
    enrollments: enrollmentCount,
    newEnrollments7d,
    completions30d,
    aiMessages7d,
    learners,
  });

  const date = utcDay(now);
  const upsert = (scopeType, scopeId, metrics) =>
    prisma.analyticsSnapshot.upsert({
      where: { scopeType_scopeId_date: { scopeType, scopeId, date } },
      create: { scopeType, scopeId, date, metrics },
      update: { metrics },
    });

  const ops = [upsert("PLATFORM", PLATFORM_SCOPE_ID, platform), ...courseRows.map((r) => upsert("COURSE", r.courseId, r.metrics))];
  for (let i = 0; i < ops.length; i += WRITE_CHUNK) {
    await prisma.$transaction(ops.slice(i, i + WRITE_CHUNK));
  }

  return { date, courses: courseRows.length, platform };
}

const todayHasSnapshot = async (now) =>
  Boolean(await prisma.analyticsSnapshot.findUnique({
    where: { scopeType_scopeId_date: { scopeType: "PLATFORM", scopeId: PLATFORM_SCOPE_ID, date: utcDay(now) } },
    select: { id: true },
  }));

/** Computes today's snapshots on first read of the day if the job hasn't run. */
async function ensureToday(now) {
  if (!(await todayHasSnapshot(now))) await computeSnapshots({ now });
}

const trendFor = (scopeType, scopeId, now) =>
  prisma.analyticsSnapshot.findMany({
    where: { scopeType, scopeId, date: { gte: new Date(utcDay(now).getTime() - (TREND_DAYS - 1) * DAY_MS) } },
    orderBy: { date: "asc" },
    select: { date: true, metrics: true },
  });

/* ------------------------------------------------------------------ */
/* HTTP-facing                                                         */
/* ------------------------------------------------------------------ */

async function getPlatform({ now = new Date() } = {}) {
  await ensureToday(now);
  const trend = await trendFor("PLATFORM", PLATFORM_SCOPE_ID, now);
  return { current: trend[trend.length - 1]?.metrics ?? null, trend };
}

async function listCourses({ now = new Date() } = {}) {
  await ensureToday(now);
  const rows = await prisma.analyticsSnapshot.findMany({ where: { scopeType: "COURSE", date: utcDay(now) } });
  return rows
    .map((r) => ({ courseId: r.scopeId, ...r.metrics }))
    .sort((a, b) => (b.enrolled ?? 0) - (a.enrolled ?? 0));
}

/** ADMIN: any course. INSTRUCTOR: own courses only; not-yours is 404. */
async function getCourse(callingUser, { courseId, now = new Date() }) {
  const course = await prisma.course.findFirst({
    where: { id: courseId, ...(callingUser?.role === "ADMIN" ? {} : { creatorId: callingUser?.id ?? "__none__" }) },
    select: { id: true },
  });
  if (!course) throw httpError(404, "Course not found");

  await ensureToday(now);
  const trend = await trendFor("COURSE", courseId, now);
  return { current: trend[trend.length - 1]?.metrics ?? null, trend };
}

/* ------------------------------------------------------------------ */
/* Cross-agent getters (original names) — never throw                  */
/* ------------------------------------------------------------------ */

/** Latest platform snapshot's metrics, or null. */
async function getPlatformKPIs() {
  try {
    const row = await prisma.analyticsSnapshot.findFirst({
      where: { scopeType: "PLATFORM", scopeId: PLATFORM_SCOPE_ID },
      orderBy: { date: "desc" },
    });
    return row ? { date: row.date, ...row.metrics } : null;
  } catch (error) {
    console.warn("[analytics] getPlatformKPIs failed", { error: error?.message });
    return null;
  }
}

/** Latest snapshot per course; all courses when courseIds is omitted. */
async function getCourseKPIsBatch(courseIds = null) {
  try {
    const latest = await prisma.analyticsSnapshot.findFirst({ where: { scopeType: "COURSE" }, orderBy: { date: "desc" }, select: { date: true } });
    if (!latest) return [];
    const rows = await prisma.analyticsSnapshot.findMany({
      where: { scopeType: "COURSE", date: latest.date, ...(courseIds ? { scopeId: { in: courseIds } } : {}) },
    });
    return rows.map((r) => ({ courseId: r.scopeId, date: r.date, ...r.metrics }));
  } catch (error) {
    console.warn("[analytics] getCourseKPIsBatch failed", { error: error?.message });
    return [];
  }
}

/** Snapshots for one scope over the last `days` days, oldest first. */
async function getSnapshots(scopeType, scopeId, { days = TREND_DAYS, now = new Date() } = {}) {
  try {
    return await prisma.analyticsSnapshot.findMany({
      where: { scopeType, scopeId, date: { gte: new Date(utcDay(now).getTime() - (days - 1) * DAY_MS) } },
      orderBy: { date: "asc" },
      select: { date: true, metrics: true },
    });
  } catch (error) {
    console.warn("[analytics] getSnapshots failed", { scopeType, scopeId, error: error?.message });
    return [];
  }
}

module.exports = {
  PLATFORM_SCOPE_ID,
  computeSnapshots,
  ensureToday,
  getPlatform,
  listCourses,
  getCourse,
  getPlatformKPIs,
  getCourseKPIsBatch,
  getSnapshots,
};
