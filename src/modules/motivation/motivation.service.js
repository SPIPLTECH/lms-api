const prisma = require("../../config/database");
const config = require("./motivation.config");
const engine = require("./motivation.engine");
const learningHealth = require("../learning-health");
const retentionService = require("../learner-model/retention.service");
const { createBackgroundQueue } = require("../../utils/backgroundQueue");
const { publish, MOTIVATION_EVENT_NAMES } = require("./motivation.events");

/**
 * Motivation agent — adaptive Phase 2.
 *
 * Keeps each learner's streak (LearningStreak) and a small set of encouraging,
 * actionable nudges (MotivationNudge). Recomputed in the background whenever
 * Learning Health updates one of the learner's courses — which already
 * happens after their own activity and in the nightly sweep — so this agent
 * needs no hooks of its own in the LMS's write paths.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/** A course the student is enrolled in, from any of the six levels. */
const enrolledVia = (studentId) => {
  const enrolled = { enrollments: { some: { studentId } } };
  return [
    { course: enrolled },
    { module: { course: enrolled } },
    { lesson: { module: { course: enrolled } } },
    { topic: { lesson: { module: { course: enrolled } } } },
    { subTopic: { topic: { lesson: { module: { course: enrolled } } } } },
    { concept: { subTopic: { topic: { lesson: { module: { course: enrolled } } } } } },
  ];
};

/** learner-model's retention read; fading concepts become revision nudges. */
async function decayedConceptsFor(studentId, now) {
  try {
    // Returns { signals, calibration } — the same shape learner-model's own
    // controller reads.
    const { signals = [] } = (await retentionService.getLearningSignals({ id: studentId }, { courseId: null, now })) ?? {};
    return signals
      .filter((s) => s.retention?.status === retentionService.RETENTION_STATUS.DECAYED)
      .map((s) => s.concept);
  } catch (error) {
    console.warn("[motivation] retention signals unavailable", { studentId, error: error?.message });
    return [];
  }
}

/**
 * Recomputes one learner's streak and nudges.
 * @param {string} studentId  StudentProfile.id
 */
async function recomputeStudent(studentId, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - config.STREAK_LOOKBACK_DAYS * DAY_MS);
  const inWindow = { gte: since };

  const [lessonRows, contentRows, attempts, submissions, enrollments, states, deadlines, decayedConcepts, existingStreak, existingNudges] =
    await Promise.all([
      prisma.lessonProgress.findMany({
        where: { studentId, OR: [{ visitedAt: inWindow }, { completedAt: inWindow }] },
        select: { visitedAt: true, completedAt: true },
      }),
      prisma.contentProgress.findMany({
        where: { studentId, OR: [{ visitedAt: inWindow }, { completedAt: inWindow }] },
        select: { visitedAt: true, completedAt: true },
      }),
      prisma.quizAttempt.findMany({ where: { studentId, submittedAt: inWindow }, select: { submittedAt: true } }),
      prisma.assignmentSubmission.findMany({ where: { studentId, submittedAt: inWindow }, select: { submittedAt: true } }),
      prisma.enrollment.findMany({
        where: { studentId },
        select: { courseId: true, progressPercent: true, completed: true, course: { select: { title: true } } },
      }),
      learningHealth.getStudentStates(studentId),
      prisma.assignment.findMany({
        where: {
          status: "ACTIVE",
          dueDate: {
            gte: new Date(now.getTime() - config.DEADLINE_OVERDUE_LOOKBACK_DAYS * DAY_MS),
            lte: new Date(now.getTime() + config.DEADLINE_LOOKAHEAD_HOURS * HOUR_MS),
          },
          submissions: { none: { studentId } },
          OR: enrolledVia(studentId),
        },
        select: { id: true, title: true, dueDate: true },
      }),
      decayedConceptsFor(studentId, now),
      prisma.learningStreak.findUnique({ where: { studentId } }),
      prisma.motivationNudge.findMany({ where: { studentId } }),
    ]);

  const activeDays = new Set(
    [
      ...lessonRows.flatMap((r) => [r.visitedAt, r.completedAt]),
      ...contentRows.flatMap((r) => [r.visitedAt, r.completedAt]),
      ...attempts.map((a) => a.submittedAt),
      ...submissions.map((s) => s.submittedAt),
    ]
      .filter((d) => d && new Date(d) >= since && new Date(d) <= now)
      .map(engine.dateKey)
  );

  const streak = engine.computeStreak({ activeDays, now, existing: existingStreak });
  const healthBy = new Map(states.map((s) => [s.courseId, s]));
  const courses = enrollments.map((e) => ({
    courseId: e.courseId,
    title: e.course?.title ?? "your course",
    progressPercent: e.progressPercent,
    completed: e.completed,
    health: healthBy.get(e.courseId) ?? null,
  }));

  const candidates = engine.detectNudges({ now, streak, courses, deadlines, decayedConcepts });
  const { creates, updates, expireIds } = engine.reconcileNudges({ existing: existingNudges, candidates, now });

  const streakRow = {
    currentDays: streak.currentDays,
    longestDays: streak.longestDays,
    status: streak.status,
    lastActiveDate: streak.lastActiveDate ? new Date(`${streak.lastActiveDate}T00:00:00.000Z`) : null,
    celebratedMilestones: streak.celebratedMilestones,
    computedAt: now,
  };

  await prisma.$transaction([
    prisma.learningStreak.upsert({ where: { studentId }, create: { studentId, ...streakRow }, update: streakRow }),
    ...(creates.length ? [prisma.motivationNudge.createMany({ data: creates.map((c) => ({ studentId, ...c })), skipDuplicates: true })] : []),
    ...updates.map((u) => prisma.motivationNudge.update({ where: { id: u.id }, data: u.data })),
    ...(expireIds.length ? [prisma.motivationNudge.updateMany({ where: { id: { in: expireIds } }, data: { status: "EXPIRED" } })] : []),
    prisma.motivationNudge.deleteMany({
      where: { studentId, status: { not: "ACTIVE" }, updatedAt: { lt: new Date(now.getTime() - config.PRUNE_AFTER_DAYS * DAY_MS) } },
    }),
  ]);

  publish(MOTIVATION_EVENT_NAMES.MOTIVATION_UPDATED, {
    studentId,
    streakDays: streak.currentDays,
    streakStatus: streak.status,
    created: creates.length,
    computedAt: now,
  });

  return { streak, created: creates.length, updated: updates.length, expired: expireIds.length };
}

/* ------------------------------------------------------------------ */
/* Trigger: react to Learning Health                                   */
/* ------------------------------------------------------------------ */

const queue = createBackgroundQueue({
  name: "motivation",
  debounceMs: config.DEBOUNCE_MS,
  concurrency: config.CONCURRENCY,
  onError: (error, key) => console.warn("[motivation] recompute failed", { studentId: key, error: error?.message }),
});

/** Never throws, never awaited. A burst for one learner collapses into one job. */
function scheduleRecompute(studentId) {
  if (!studentId || process.env.MOTIVATION_DISABLED === "true") return;
  queue.schedule(studentId, () => recomputeStudent(studentId));
}

let unsubscribe = null;

/** Called once from server.js: subscribe to Learning Health's updates. */
function bootstrap() {
  if (unsubscribe) return;
  unsubscribe = learningHealth.subscribe(learningHealth.LEARNING_HEALTH_EVENT_NAMES.STATE_UPDATED, (payload) =>
    scheduleRecompute(payload?.studentId)
  );
}

/* ------------------------------------------------------------------ */
/* Student API                                                         */
/* ------------------------------------------------------------------ */

async function resolveOwnStudent(user) {
  const profile = await prisma.studentProfile.findUnique({ where: { userId: user?.id ?? "__none__" }, select: { id: true } });
  if (!profile) throw httpError(404, "Student profile not found");
  return profile;
}

const toStreakDto = (row) =>
  row
    ? { currentDays: row.currentDays, longestDays: row.longestDays, status: row.status, lastActiveDate: row.lastActiveDate }
    : { currentDays: 0, longestDays: 0, status: "BROKEN", lastActiveDate: null };

const toNudgeDto = (row) => ({
  id: row.id,
  type: row.type,
  priority: row.priority,
  title: row.title,
  message: row.message,
  ctaHref: row.ctaHref,
  courseId: row.courseId,
  createdAt: row.createdAt,
});

/** The signed-in student's streak and nudges. Computes once on first view. */
async function getMyMotivation(user, { now = new Date() } = {}) {
  const { id: studentId } = await resolveOwnStudent(user);

  let streak = await prisma.learningStreak.findUnique({ where: { studentId } });
  if (!streak) {
    await recomputeStudent(studentId, { now });
    streak = await prisma.learningStreak.findUnique({ where: { studentId } });
  }

  const rows = await prisma.motivationNudge.findMany({ where: { studentId, status: "ACTIVE" } });
  return { streak: toStreakDto(streak), nudges: engine.visibleNudges(rows, now).map(toNudgeDto) };
}

/** Dismiss one of the student's own nudges; anyone else's is 404. */
async function dismissNudge(user, nudgeId) {
  const { id: studentId } = await resolveOwnStudent(user);
  const result = await prisma.motivationNudge.updateMany({
    where: { id: nudgeId, studentId, status: "ACTIVE" },
    data: { status: "DISMISSED" },
  });
  if (result.count === 0) throw httpError(404, "Nudge not found");
  return { id: nudgeId, status: "DISMISSED" };
}

/* ------------------------------------------------------------------ */
/* Cross-agent getters — never throw                                   */
/* ------------------------------------------------------------------ */

async function getStreak(studentId) {
  try {
    const row = await prisma.learningStreak.findUnique({ where: { studentId } });
    return row ? toStreakDto(row) : null;
  } catch (error) {
    console.warn("[motivation] getStreak failed", { studentId, error: error?.message });
    return null;
  }
}

async function getActiveNudges(studentId, { now = new Date() } = {}) {
  try {
    const rows = await prisma.motivationNudge.findMany({ where: { studentId, status: "ACTIVE" } });
    return engine.visibleNudges(rows, now).map(toNudgeDto);
  } catch (error) {
    console.warn("[motivation] getActiveNudges failed", { studentId, error: error?.message });
    return [];
  }
}

async function getBatchStreaks(studentIds) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return [];
  try {
    const rows = await prisma.learningStreak.findMany({ where: { studentId: { in: studentIds } } });
    return rows.map((row) => ({ studentId: row.studentId, ...toStreakDto(row) }));
  } catch (error) {
    console.warn("[motivation] getBatchStreaks failed", { error: error?.message });
    return [];
  }
}

module.exports = {
  bootstrap,
  scheduleRecompute,
  recomputeStudent,
  getMyMotivation,
  dismissNudge,
  getStreak,
  getActiveNudges,
  getBatchStreaks,
  _queue: queue,
};
