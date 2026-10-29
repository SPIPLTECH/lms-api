const prisma = require("../../config/database");
const config = require("./studyPlan.config");
const engine = require("./studyPlan.engine");
const learningHealth = require("../learning-health");
const progressService = require("../progress/progress.service");
const retentionService = require("../learner-model/retention.service");
const { createBackgroundQueue } = require("../../utils/backgroundQueue");
const { publish, STUDY_PLAN_EVENT_NAMES } = require("./studyPlan.events");

/**
 * Learning Path agent — adaptive Phase 3 (served as /study-plan: the
 * "learning path" name is already the course sequence's).
 *
 * Turns the course's remaining learning sequence into a 7-day study plan
 * sized to the learner's own weekly hours, paced by Learning Health's signals,
 * with learner-model's fading concepts slotted in for revision.
 *
 * Reads the sequence with persist: false — exactly the read-only path the
 * LMS's own access checks use — so building a plan never writes progress.
 */

const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });

async function decayedConceptsFor(studentId, courseId, now) {
  try {
    // Returns { signals, calibration } — the same shape learner-model's own
    // controller reads.
    const { signals = [] } = (await retentionService.getLearningSignals({ id: studentId }, { courseId, now })) ?? {};
    return signals
      .filter((s) => s.retention?.status === retentionService.RETENTION_STATUS.DECAYED)
      .map((s) => s.concept);
  } catch (error) {
    console.warn("[study-plan] retention signals unavailable", { studentId, courseId, error: error?.message });
    return [];
  }
}

/** Recomputes and stores one learner's plan for one course. */
async function recomputePlan(studentId, courseId, { now = new Date() } = {}) {
  const [{ sequence }, profile, health, decayedConcepts] = await Promise.all([
    progressService.computeStudentSequence(studentId, courseId, { persist: false }),
    prisma.studentProfile.findUnique({ where: { id: studentId }, select: { weeklyStudyHours: true } }),
    learningHealth.getState(studentId, courseId),
    decayedConceptsFor(studentId, courseId, now),
  ]);

  const steps = sequence?.steps ?? [];
  const remainingIds = steps.filter((s) => !s.completed).map((s) => s.contentId).filter(Boolean);
  const contents = remainingIds.length
    ? await prisma.content.findMany({ where: { id: { in: remainingIds } }, select: { id: true, duration: true } })
    : [];

  const plan = engine.buildPlan({
    courseId,
    steps,
    durations: new Map(contents.map((c) => [c.id, c.duration])),
    weeklyStudyHours: profile?.weeklyStudyHours ?? null,
    health,
    decayedConcepts,
    now,
  });

  const row = { ...plan, computedAt: now };
  const saved = await prisma.studyPlan.upsert({
    where: { studentId_courseId: { studentId, courseId } },
    create: { studentId, courseId, ...row },
    update: row,
  });

  publish(STUDY_PLAN_EVENT_NAMES.PLAN_UPDATED, {
    studentId,
    courseId,
    remainingSteps: plan.remainingSteps,
    estimatedCompletionAt: plan.estimatedCompletionAt,
    computedAt: now,
  });

  return saved;
}

/* ------------------------------------------------------------------ */
/* Trigger: react to Learning Health                                   */
/* ------------------------------------------------------------------ */

const queue = createBackgroundQueue({
  name: "study-plan",
  debounceMs: config.DEBOUNCE_MS,
  concurrency: config.CONCURRENCY,
  onError: (error, key) => console.warn("[study-plan] recompute failed", { key, error: error?.message }),
});

function scheduleRecompute(studentId, courseId) {
  if (!studentId || !courseId || process.env.STUDY_PLAN_DISABLED === "true") return;
  queue.schedule(`${studentId}:${courseId}`, () => recomputePlan(studentId, courseId));
}

let unsubscribe = null;

/** Called once from server.js. */
function bootstrap() {
  if (unsubscribe) return;
  unsubscribe = learningHealth.subscribe(learningHealth.LEARNING_HEALTH_EVENT_NAMES.STATE_UPDATED, (payload) =>
    scheduleRecompute(payload?.studentId, payload?.courseId)
  );
}

/* ------------------------------------------------------------------ */
/* Student API                                                         */
/* ------------------------------------------------------------------ */

const toPlanDto = (row) => ({
  courseId: row.courseId,
  dailyMinutes: row.dailyMinutes,
  adjustment: row.adjustment,
  adjustmentReason: row.adjustmentReason,
  remainingSteps: row.remainingSteps,
  remainingMinutes: row.remainingMinutes,
  estimatedCompletionAt: row.estimatedCompletionAt,
  days: row.days,
  revision: row.revision ?? [],
  computedAt: row.computedAt,
});

/**
 * The signed-in student's plan for a course they are enrolled in (404
 * otherwise). Built on first view and refreshed once it is a day old.
 */
async function getMyPlan(user, { courseId, now = new Date() }) {
  const profile = await prisma.studentProfile.findUnique({ where: { userId: user?.id ?? "__none__" }, select: { id: true } });
  if (!profile) throw httpError(404, "Student profile not found");

  const enrollment = await prisma.enrollment.findUnique({
    where: { studentId_courseId: { studentId: profile.id, courseId } },
    select: { id: true },
  });
  if (!enrollment) throw httpError(404, "Course not found");

  let row = await prisma.studyPlan.findUnique({ where: { studentId_courseId: { studentId: profile.id, courseId } } });
  if (!row || now.getTime() - new Date(row.computedAt).getTime() > config.STALE_AFTER_MS) {
    row = await recomputePlan(profile.id, courseId, { now });
  }
  return toPlanDto(row);
}

/* ------------------------------------------------------------------ */
/* Cross-agent getters — never throw                                   */
/* ------------------------------------------------------------------ */

async function getPlan(studentId, courseId) {
  try {
    const row = await prisma.studyPlan.findUnique({ where: { studentId_courseId: { studentId, courseId } } });
    return row ? toPlanDto(row) : null;
  } catch (error) {
    console.warn("[study-plan] getPlan failed", { studentId, courseId, error: error?.message });
    return null;
  }
}

async function getBatchPlans(courseId, studentIds) {
  if (!Array.isArray(studentIds) || studentIds.length === 0) return [];
  try {
    const rows = await prisma.studyPlan.findMany({ where: { courseId, studentId: { in: studentIds } } });
    return rows.map((row) => ({ studentId: row.studentId, ...toPlanDto(row) }));
  } catch (error) {
    console.warn("[study-plan] getBatchPlans failed", { courseId, error: error?.message });
    return [];
  }
}

module.exports = { bootstrap, scheduleRecompute, recomputePlan, getMyPlan, getPlan, getBatchPlans, _queue: queue };
