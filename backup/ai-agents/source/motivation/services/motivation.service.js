const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

const actionRepository = require("../repositories/motivationAction.repository");
const historyRepository = require("../repositories/motivationHistory.repository");
const reminderRepository = require("../repositories/reminderSchedule.repository");
const streakRepository = require("../repositories/studentStreak.repository");
const trendRepository = require("../repositories/engagementTrend.repository");
const analyticsRepository = require("../repositories/motivationAnalytics.repository");

const { buildContext } = require("./context/studentContextBuilder");
const { detectAllCandidates } = require("./domain/detectors");
const { evaluateStreak } = require("./domain/streakEvaluator");
const { computeNextRunAt } = require("./domain/reminderScheduler");

const { motivationBus } = require("../events/eventBus");
const { MOTIVATION_EVENT_NAMES } = require("../events/eventNames");

const {
  toActionListResponse,
  toReminderListResponse,
  toStreakResponse,
  toFullStateResponse,
  toAcknowledgeResponse,
  toHistoryResponse,
} = require("../dto/motivationResponse.dto");

const {
  MOTIVATION_STATUS,
  MOTIVATION_ACTION_TYPE,
  REMINDER_CADENCE,
  RETIRED_REASON,
  DEFAULT_EXPIRY_HOURS,
  DEFAULT_PREFERRED_HOUR,
  ENGAGEMENT_TREND_WINDOW_DAYS,
} = require("../constants");

const HOUR_MS = 3600 * 1000;

/**
 * Provisions this student's DAILY_REMINDER schedule the first time their
 * motivation state is computed — nextRunAt seeded from Student State's
 * preferredLearningHour when known, DEFAULT_PREFERRED_HOUR otherwise.
 * Idempotent: only creates, never resets an already-scheduled reminder.
 */
const ensureReminderSchedules = async (studentId, context) => {
  const preferredHour = context.learningState?.behavior?.preferredLearningHour ?? DEFAULT_PREFERRED_HOUR;
  const nextRunAt = computeNextRunAt(REMINDER_CADENCE.DAILY, preferredHour, context.now);

  await reminderRepository.ensureSchedule(studentId, {
    reminderType: MOTIVATION_ACTION_TYPE.DAILY_REMINDER,
    cadence: REMINDER_CADENCE.DAILY,
    preferredHour,
    nextRunAt,
  });
};

const resolveExpiresAt = (candidate, now) => {
  if (candidate.expiresAt) return candidate.expiresAt;
  const hours = DEFAULT_EXPIRY_HOURS[candidate.type];
  return hours ? new Date(now.getTime() + hours * HOUR_MS) : null;
};

const retiredReasonToStatus = {
  [RETIRED_REASON.SUPERSEDED]: MOTIVATION_STATUS.EXPIRED,
  [RETIRED_REASON.EXPIRED]: MOTIVATION_STATUS.EXPIRED,
  [RETIRED_REASON.ACKNOWLEDGED]: MOTIVATION_STATUS.ACKNOWLEDGED,
  [RETIRED_REASON.DISMISSED]: MOTIVATION_STATUS.DISMISSED,
};

/** Snapshots the row to history, then transitions its live status — always inside one transaction. */
const retireAction = (action, retiredReason) =>
  prisma.$transaction(async (tx) => {
    await historyRepository.createSnapshot(action, retiredReason, tx);
    await actionRepository.updateStatus(action.id, retiredReasonToStatus[retiredReason], tx);
  });

/**
 * The core pipeline: Analyze Student Context -> Determine Motivation
 * Strategy (streak evaluation + trend + burnout, then run every detector)
 * -> Persist -> Publish. Called on every trigger (debounced event,
 * scheduler, or explicit POST /motivation/recalculate).
 *
 * @param {string} studentId
 * @param {string} [trigger] - for logging only.
 */
const generateForStudent = async (studentId, trigger = "manual") => {
  const context = await buildContext(studentId);
  await ensureReminderSchedules(studentId, context);

  const streakEvaluation = evaluateStreak({
    consecutiveLearningDays: context.learningState?.engagement?.consecutiveLearningDays || 0,
    preferredLearningHour: context.learningState?.behavior?.preferredLearningHour ?? null,
    existingStreak: context.streak,
    now: context.now,
  });

  await streakRepository.upsert(studentId, {
    currentStreakDays: streakEvaluation.currentStreakDays,
    longestStreakDays: streakEvaluation.longestStreakDays,
    streakStatus: streakEvaluation.streakStatus,
    lastActiveDate: streakEvaluation.lastActiveDate,
    lastBrokenAt: streakEvaluation.lastBrokenAt,
    celebratedStreakMilestones: streakEvaluation.celebratedStreakMilestones,
  });

  const recentTrends = await trendRepository.findRecentByStudent(studentId, ENGAGEMENT_TREND_WINDOW_DAYS);
  const recentTrendScoresOldestFirst = recentTrends.map((t) => t.performanceScore).reverse();

  const candidates = detectAllCandidates(context, streakEvaluation, recentTrendScoresOldestFirst);

  const existingActive = await actionRepository.findAllActiveDedupeKeys(studentId);
  const candidateDedupeKeys = new Set(candidates.map((c) => c.dedupeKey));

  const persisted = [];
  for (const candidate of candidates) {
    const expiresAt = resolveExpiresAt(candidate, context.now);
    const recommendedAt = candidate.recommendedAt || context.now;
    const row = await actionRepository.upsertCandidate(studentId, { ...candidate, recommendedAt }, expiresAt);
    persisted.push(row);
    await analyticsRepository.increment(candidate.type, "generatedCount", context.now);
  }

  // Anything still ACTIVE but not regenerated this cycle no longer applies
  // (e.g. the deadline passed, the streak risk resolved) — respects
  // explicit ACKNOWLEDGED/DISMISSED feedback by construction: only rows
  // this query returns (status=ACTIVE) are touched.
  const toRetire = existingActive.filter((row) => !candidateDedupeKeys.has(row.dedupeKey));
  for (const row of toRetire) {
    const full = await actionRepository.findById(row.id);
    if (full) await retireAction(full, RETIRED_REASON.SUPERSEDED);
  }

  motivationBus.publish(MOTIVATION_EVENT_NAMES.MOTIVATION_UPDATED, {
    studentId,
    trigger,
    count: persisted.length,
    timestamp: context.now,
  });

  return { studentId, generated: persisted.length, retired: toRetire.length };
};

const recalculate = (studentId) => generateForStudent(studentId, "manual-recalculate");

const getByStudent = async (studentId) => {
  const [actions, streak] = await Promise.all([actionRepository.findActiveByStudent(studentId), streakRepository.findByStudent(studentId)]);
  return toFullStateResponse(studentId, { actions, streak });
};

const getReminders = async (studentId) => {
  const reminders = await reminderRepository.findByStudent(studentId);
  return toReminderListResponse(studentId, reminders);
};

const getStreak = async (studentId) => {
  const streak = await streakRepository.findByStudent(studentId);
  return toStreakResponse(studentId, streak);
};

const getActions = async (studentId, { type, priority } = {}) => {
  const actions = await actionRepository.findActiveByStudent(studentId, { type, priority });
  return toActionListResponse(studentId, actions);
};

/**
 * Batch read for cross-agent consumers aggregating many students at once
 * (e.g. Teacher Insight's class-wide reads) — two queries instead of 2N.
 * Returns flat, unshaped rows since class-wide aggregation groups by
 * type/streak status across students, not per student.
 *
 * @param {string[]} studentIds
 */
const getBatchMotivationSummary = async (studentIds) => {
  if (studentIds.length === 0) return { actions: [], streaks: [] };

  const [actions, streaks] = await Promise.all([
    actionRepository.findActiveByStudents(studentIds),
    streakRepository.findByStudents(studentIds),
  ]);

  return { actions, streaks };
};

const getHistory = async (studentId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;
  const [history, total] = await Promise.all([
    historyRepository.findByStudent(studentId, { skip, take: limit }),
    historyRepository.countByStudent(studentId),
  ]);
  return toHistoryResponse(studentId, history, { page, limit, total, totalPages: Math.ceil(total / limit) || 1 });
};

/** POST /motivation/acknowledge — the only feedback this agent accepts; there's no separate DISMISSED action from the API, only via natural expiry/supersession. */
const acknowledge = async (studentId, { motivationActionId }) => {
  const action = await actionRepository.findById(motivationActionId);
  if (!action || action.studentId !== studentId) {
    throw new ApiError(404, "Motivation action not found");
  }

  if (action.status === MOTIVATION_STATUS.ACTIVE) {
    await retireAction(action, RETIRED_REASON.ACKNOWLEDGED);
    await analyticsRepository.increment(action.type, "acknowledgedCount");
  }

  const updated = await actionRepository.findById(motivationActionId);
  return toAcknowledgeResponse(updated);
};

/** Used by schedulers/engagementSweep.scheduler.js to sweep time-based expiry. */
const expireStaleActions = async (now = new Date()) => {
  const expired = await actionRepository.findExpiredActive(now);
  for (const row of expired) {
    await retireAction(row, RETIRED_REASON.EXPIRED);
    await analyticsRepository.increment(row.type, "expiredCount", now);
  }
  return expired.length;
};

module.exports = {
  generateForStudent,
  recalculate,
  getByStudent,
  getReminders,
  getStreak,
  getActions,
  getHistory,
  getBatchMotivationSummary,
  acknowledge,
  expireStaleActions,
};
