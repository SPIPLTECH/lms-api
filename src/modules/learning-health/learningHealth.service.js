const prisma = require("../../config/database");
const config = require("./learningHealth.config");
const signals = require("./learningHealth.signals");
const { scoreLearner } = require("./learningHealth.scoring");
const { publish, LEARNING_HEALTH_EVENT_NAMES } = require("./learningHealth.events");

/**
 * Learning Health agent — adaptive Phase 1.
 *
 * Keeps one LearningHealth row per (student, course): engagement,
 * performance, consistency, deadline and dropout risk, with plain-English
 * reasons. Recomputed in the background — debounced after a learner's own
 * writes (scheduleRecompute) and nightly for everyone (sweepAll) — so no LMS
 * request ever waits on it. Other agents read it through index.js only.
 */

const DAY_MS = 86_400_000;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

const utcDay = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const chunk = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/* ------------------------------------------------------------------ */
/* Recompute                                                           */
/* ------------------------------------------------------------------ */

async function persistResults(courseId, results, now) {
  const date = utcDay(now);

  for (const batch of chunk(results, config.WRITE_CHUNK_SIZE)) {
    await prisma.$transaction(
      batch.flatMap(({ studentId, state }) => {
        const row = { ...state, computedAt: now };
        const history = {
          riskScore: state.riskScore,
          riskLevel: state.riskLevel,
          engagementScore: state.engagementScore,
          performanceScore: state.performanceScore,
          consistencyScore: state.consistencyScore,
        };
        return [
          prisma.learningHealth.upsert({
            where: { studentId_courseId: { studentId, courseId } },
            create: { studentId, courseId, ...row },
            update: row,
          }),
          prisma.learningHealthHistory.upsert({
            where: { studentId_courseId_date: { studentId, courseId, date } },
            create: { studentId, courseId, date, ...history },
            update: history,
          }),
        ];
      })
    );
  }

  for (const { studentId, state, previousRiskLevel } of results) {
    publish(LEARNING_HEALTH_EVENT_NAMES.STATE_UPDATED, {
      studentId,
      courseId,
      riskLevel: state.riskLevel,
      previousRiskLevel,
      computedAt: now,
    });
  }
}

/**
 * Recomputes and stores Learning Health for one course.
 *
 * @param {string} courseId
 * @param {{studentIds?: string[]|null, now?: Date}} [options]
 * @returns {Promise<number>} learners recomputed
 */
async function recomputeCourse(courseId, { studentIds = null, now = new Date() } = {}) {
  const rows = await signals.fetchCourseSignals(courseId, { studentIds, now });
  const results = rows.map((r) => ({
    studentId: r.studentId,
    previousRiskLevel: r.previousRiskLevel,
    state: scoreLearner(r.signals),
  }));
  if (results.length > 0) await persistResults(courseId, results, now);
  return results.length;
}

const sweepCourse = (courseId, options = {}) => recomputeCourse(courseId, options);

/**
 * Every course with an active enrolment, one course at a time (bounds DB
 * load). A failing course is logged and skipped.
 *
 * @returns {Promise<{courses: number, students: number, failed: number}>}
 */
async function sweepAll({ now = new Date() } = {}) {
  const courses = await prisma.enrollment.groupBy({ by: ["courseId"], where: { completed: false } });
  let students = 0;
  let failed = 0;

  for (const { courseId } of courses) {
    try {
      students += await recomputeCourse(courseId, { now });
    } catch (error) {
      failed += 1;
      console.warn("[learning-health] sweep failed for course", { courseId, error: error?.message });
    }
  }

  return { courses: courses.length, students, failed };
}

/* ------------------------------------------------------------------ */
/* Write-path trigger                                                  */
/* ------------------------------------------------------------------ */

const pending = new Map();

const isDisabled = () =>
  process.env.LEARNING_HEALTH_DISABLED === "true" ||
  // Under `node --test`, existing tests drive quiz/progress/assignment code
  // whose hooks would otherwise schedule real DB work after they finish.
  (Boolean(process.env.NODE_TEST_CONTEXT) && process.env.LEARNING_HEALTH_ENABLE_IN_TESTS !== "true");

/**
 * Called from the LMS's write paths (quiz submit, assignment submit, content/
 * lesson completion, visits). Synchronous, never throws, never awaited: it
 * only (re)sets a timer, so the calling flow is unchanged. Repeated calls for
 * the same (student, course) inside DEBOUNCE_MS collapse into one recompute.
 *
 * @param {string} studentId  StudentProfile.id
 * @param {string} courseId
 */
function scheduleRecompute(studentId, courseId) {
  try {
    if (!studentId || !courseId || isDisabled()) return;

    const key = `${studentId}:${courseId}`;
    const existing = pending.get(key);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      pending.delete(key);
      recomputeCourse(courseId, { studentIds: [studentId] }).catch((error) => {
        console.warn("[learning-health] recompute failed", { studentId, courseId, error: error?.message });
      });
    }, config.DEBOUNCE_MS);
    if (typeof timer?.unref === "function") timer.unref();

    pending.set(key, timer);
  } catch (error) {
    console.warn("[learning-health] could not schedule recompute", { studentId, courseId, error: error?.message });
  }
}

/* ------------------------------------------------------------------ */
/* Instructor/admin read API                                           */
/* ------------------------------------------------------------------ */

/**
 * ADMIN: any course. INSTRUCTOR: only courses they created. Missing and
 * not-yours are both 404, so an instructor cannot probe for course ids.
 */
async function assertCourseAccess(callingUser, courseId) {
  if (!courseId) throw httpError(400, "courseId is required");

  const course = await prisma.course.findFirst({
    where: {
      id: courseId,
      ...(callingUser?.role === "ADMIN" ? {} : { creatorId: callingUser?.id ?? "__none__" }),
    },
    select: { id: true, title: true },
  });

  if (!course) throw httpError(404, "Course not found");
  return course;
}

const toLearnerDto = (row) => ({
  studentId: row.studentId,
  name: row.student?.user?.name ?? null,
  email: row.student?.user?.email ?? null,
  riskLevel: row.riskLevel,
  riskScore: row.riskScore,
  riskReasons: Array.isArray(row.riskReasons) ? row.riskReasons : [],
  engagementScore: row.engagementScore,
  performanceScore: row.performanceScore,
  consistencyScore: row.consistencyScore,
  progressPercent: row.progressPercent,
  inactivityDays: row.inactivityDays,
  lastActivityAt: row.lastActivityAt ?? null,
  deadlineRisk: row.deadlineRisk,
  completionProbability: row.completionProbability,
  improvementTrend: row.improvementTrend,
  computedAt: row.computedAt,
});

const LEARNER_INCLUDE = { student: { select: { id: true, user: { select: { name: true, email: true } } } } };

const levelSummary = async (courseId) => {
  const groups = await prisma.learningHealth.groupBy({
    by: ["riskLevel"],
    where: { courseId },
    _count: { _all: true },
    _max: { computedAt: true },
  });
  const counts = Object.fromEntries(config.RISK_LEVELS.map((level) => [level, 0]));
  let computedAt = null;
  for (const g of groups) {
    counts[g.riskLevel] = g._count._all;
    if (g._max.computedAt && (!computedAt || g._max.computedAt > computedAt)) computedAt = g._max.computedAt;
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return { counts, total, computedAt };
};

/**
 * The course roster, most at-risk first.
 * Cold start: if nothing has been computed yet for a course with enrolments,
 * computes it once before answering, so the first view is never empty.
 */
async function getCourseOverview(callingUser, { courseId, riskLevel = null, limit = 50, offset = 0 }) {
  await assertCourseAccess(callingUser, courseId);

  let summary = await levelSummary(courseId);
  if (summary.total === 0) {
    const enrolled = await prisma.enrollment.count({ where: { courseId } });
    if (enrolled > 0) {
      await recomputeCourse(courseId);
      summary = await levelSummary(courseId);
    }
  }

  const where = { courseId, ...(riskLevel ? { riskLevel } : {}) };
  const [rows, filteredTotal] = await Promise.all([
    prisma.learningHealth.findMany({
      where,
      orderBy: [{ riskScore: "desc" }, { inactivityDays: "desc" }],
      skip: offset,
      take: limit,
      include: LEARNER_INCLUDE,
    }),
    prisma.learningHealth.count({ where }),
  ]);

  return { summary, learners: rows.map(toLearnerDto), pagination: { limit, offset, total: filteredTotal } };
}

/** One learner's current state plus the last HISTORY_DAYS of daily history. */
async function getLearnerDetail(callingUser, { courseId, studentId, now = new Date() }) {
  await assertCourseAccess(callingUser, courseId);

  const where = { studentId_courseId: { studentId, courseId } };
  let row = await prisma.learningHealth.findUnique({ where, include: LEARNER_INCLUDE });
  if (!row) {
    const recomputed = await recomputeCourse(courseId, { studentIds: [studentId], now });
    if (recomputed > 0) row = await prisma.learningHealth.findUnique({ where, include: LEARNER_INCLUDE });
  }
  if (!row) throw httpError(404, "Learner not found in this course");

  const history = await prisma.learningHealthHistory.findMany({
    where: { studentId, courseId, date: { gte: new Date(utcDay(now).getTime() - (config.HISTORY_DAYS - 1) * DAY_MS) } },
    orderBy: { date: "asc" },
    select: { date: true, riskScore: true, riskLevel: true, engagementScore: true, performanceScore: true, consistencyScore: true },
  });

  return { ...toLearnerDto(row), history };
}

const lastManualRecompute = new Map();

/**
 * Instructor "Refresh now". Rate-limited per course; a throttled call is
 * reported, not thrown, so the controller can answer 429 with retry info.
 */
async function manualRecompute(callingUser, { courseId, now = new Date() }) {
  await assertCourseAccess(callingUser, courseId);

  const last = lastManualRecompute.get(courseId);
  if (last && now.getTime() - last < config.MANUAL_RECOMPUTE_COOLDOWN_MS) {
    return {
      throttled: true,
      retryAfterSeconds: Math.ceil((config.MANUAL_RECOMPUTE_COOLDOWN_MS - (now.getTime() - last)) / 1000),
    };
  }

  lastManualRecompute.set(courseId, now.getTime());
  const recomputed = await recomputeCourse(courseId, { now });
  return { throttled: false, recomputed, computedAt: now };
}

/* ------------------------------------------------------------------ */
/* Cross-agent getters (public surface — see index.js)                 */
/* Return null / [] on no data or failure; never throw.                */
/* ------------------------------------------------------------------ */

async function getState(studentId, courseId) {
  try {
    return await prisma.learningHealth.findUnique({ where: { studentId_courseId: { studentId, courseId } } });
  } catch (error) {
    console.warn("[learning-health] getState failed", { studentId, courseId, error: error?.message });
    return null;
  }
}

async function getCourseStates(courseId) {
  try {
    return await prisma.learningHealth.findMany({ where: { courseId } });
  } catch (error) {
    console.warn("[learning-health] getCourseStates failed", { courseId, error: error?.message });
    return [];
  }
}

/**
 * Per-course aggregates for every course at once (Analytics reads this):
 * learners per risk level, learners active in the last 7 days, mean
 * engagement. Three grouped queries regardless of course count.
 *
 * @returns {Promise<Map<string, {riskCounts: Record<string, number>, activeLearners7d: number, avgEngagement: number|null, total: number}>>}
 */
async function getCourseAggregates() {
  try {
    const [byLevel, active, engagement] = await Promise.all([
      prisma.learningHealth.groupBy({ by: ["courseId", "riskLevel"], _count: { _all: true } }),
      prisma.learningHealth.groupBy({ by: ["courseId"], where: { inactivityDays: { lt: 7 } }, _count: { _all: true } }),
      prisma.learningHealth.groupBy({ by: ["courseId"], _avg: { engagementScore: true } }),
    ]);
    const out = new Map();
    const entry = (courseId) => {
      if (!out.has(courseId)) {
        out.set(courseId, {
          riskCounts: Object.fromEntries(config.RISK_LEVELS.map((l) => [l, 0])),
          activeLearners7d: 0,
          avgEngagement: null,
          total: 0,
        });
      }
      return out.get(courseId);
    };
    for (const g of byLevel) {
      const e = entry(g.courseId);
      e.riskCounts[g.riskLevel] = g._count._all;
      e.total += g._count._all;
    }
    for (const g of active) entry(g.courseId).activeLearners7d = g._count._all;
    for (const g of engagement) entry(g.courseId).avgEngagement = g._avg.engagementScore;
    return out;
  } catch (error) {
    console.warn("[learning-health] getCourseAggregates failed", { error: error?.message });
    return new Map();
  }
}

/**
 * Platform-wide distinct-learner counts (a learner in three courses counts
 * once): active in the last 7 days, and at HIGH/CRITICAL risk in any course.
 */
async function getPlatformAggregates() {
  try {
    const [active, atRisk] = await Promise.all([
      prisma.learningHealth.groupBy({ by: ["studentId"], where: { inactivityDays: { lt: 7 } } }),
      prisma.learningHealth.groupBy({ by: ["studentId"], where: { riskLevel: { in: ["HIGH", "CRITICAL"] } } }),
    ]);
    return { activeLearners7d: active.length, atRiskLearners: atRisk.length };
  } catch (error) {
    console.warn("[learning-health] getPlatformAggregates failed", { error: error?.message });
    return { activeLearners7d: null, atRiskLearners: null };
  }
}

/** Every course's state for one learner (Motivation reads this). */
async function getStudentStates(studentId) {
  try {
    return await prisma.learningHealth.findMany({ where: { studentId } });
  } catch (error) {
    console.warn("[learning-health] getStudentStates failed", { studentId, error: error?.message });
    return [];
  }
}

async function getBatchStates(courseId, studentIds) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return [];
  try {
    return await prisma.learningHealth.findMany({ where: { courseId, studentId: { in: studentIds } } });
  } catch (error) {
    console.warn("[learning-health] getBatchStates failed", { courseId, error: error?.message });
    return [];
  }
}

async function getHighRiskStudents({ levels = ["HIGH", "CRITICAL"], courseIds = null } = {}) {
  try {
    return await prisma.learningHealth.findMany({
      where: { riskLevel: { in: levels }, ...(courseIds ? { courseId: { in: courseIds } } : {}) },
      orderBy: { riskScore: "desc" },
    });
  } catch (error) {
    console.warn("[learning-health] getHighRiskStudents failed", { error: error?.message });
    return [];
  }
}

module.exports = {
  scheduleRecompute,
  recomputeCourse,
  sweepCourse,
  sweepAll,
  getCourseOverview,
  getLearnerDetail,
  manualRecompute,
  getState,
  getCourseStates,
  getStudentStates,
  getBatchStates,
  getHighRiskStudents,
  getCourseAggregates,
  getPlatformAggregates,
  // test seams
  _pending: pending,
  _lastManualRecompute: lastManualRecompute,
};
