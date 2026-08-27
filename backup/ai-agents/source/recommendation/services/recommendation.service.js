const prisma = require("../../../config/database");
const ApiError = require("../../../utils/ApiError");

const recommendationRepository = require("../repositories/recommendation.repository");
const historyRepository = require("../repositories/recommendationHistory.repository");
const feedbackRepository = require("../repositories/recommendationFeedback.repository");
const ruleRepository = require("../repositories/recommendationRule.repository");
const analyticsRepository = require("../repositories/recommendationAnalytics.repository");

const { buildContext } = require("./context/studentContextBuilder");
const { generateAllCandidates } = require("./domain/generators");
const { rankAndScore } = require("./domain/rankingEngine");
const { computeAdjustmentMultiplier } = require("./domain/feedbackAdjustment");

const { recommendationBus } = require("../events/eventBus");
const { RECOMMENDATION_EVENT_NAMES } = require("../events/eventNames");

const {
  toRecommendationListResponse,
  toTodayResponse,
  toFeedbackResponse,
} = require("../dto/recommendationResponse.dto");

const {
  RECOMMENDATION_STATUS,
  RETIRED_REASON,
  FEEDBACK_ACTION,
  DEFAULT_EXPIRY_HOURS,
  LEARNING_TYPES,
  REVISION_TYPES,
} = require("../constants");

const HOUR_MS = 3600 * 1000;

const resolveExpiresAt = (candidate, now) => {
  if (candidate.expiresAt) return candidate.expiresAt;
  const hours = DEFAULT_EXPIRY_HOURS[candidate.type];
  return hours ? new Date(now.getTime() + hours * HOUR_MS) : null;
};

const retiredReasonToStatus = {
  [RETIRED_REASON.SUPERSEDED]: RECOMMENDATION_STATUS.EXPIRED,
  [RETIRED_REASON.EXPIRED]: RECOMMENDATION_STATUS.EXPIRED,
  [RETIRED_REASON.COMPLETED]: RECOMMENDATION_STATUS.COMPLETED,
  [RETIRED_REASON.DISMISSED]: RECOMMENDATION_STATUS.DISMISSED,
};

/** Snapshots the row to history, then transitions its live status — always inside one transaction. */
const retireRecommendation = (recommendation, retiredReason) =>
  prisma.$transaction(async (tx) => {
    await historyRepository.createSnapshot(recommendation, retiredReason, tx);
    await recommendationRepository.updateStatus(recommendation.id, retiredReasonToStatus[retiredReason], tx);
  });

/**
 * Builds a { [type]: multiplier } lookup combining per-student feedback
 * history with any admin-configured RecommendationRule weight overrides.
 */
const buildAdjustmentLookup = async (studentId, candidateTypes) => {
  const uniqueTypes = [...new Set(candidateTypes)];

  const [feedbackByType, activeRules] = await Promise.all([
    Promise.all(uniqueTypes.map((type) => feedbackRepository.findRecentByStudentAndType(studentId, type))),
    ruleRepository.findActiveRules(),
  ]);

  const ruleMultiplierByType = new Map();
  for (const rule of activeRules) {
    if (rule.type) ruleMultiplierByType.set(rule.type, rule.weightMultiplier);
  }

  const multiplierByType = new Map();
  uniqueTypes.forEach((type, index) => {
    const feedbackMultiplier = computeAdjustmentMultiplier(feedbackByType[index]);
    const ruleMultiplier = ruleMultiplierByType.get(type) ?? 1;
    multiplierByType.set(type, feedbackMultiplier * ruleMultiplier);
  });

  return (type) => multiplierByType.get(type) ?? 1;
};

/**
 * The core pipeline: Analyze Student Context -> Score Candidates -> Rank ->
 * Persist -> Publish. Called on every trigger (debounced event, scheduler,
 * or explicit POST /recommendations/recalculate).
 *
 * @param {string} studentId
 * @param {string} [trigger] - for logging only.
 */
const generateForStudent = async (studentId, trigger = "manual") => {
  const context = await buildContext(studentId);
  const candidates = generateAllCandidates(context);

  const getAdjustmentMultiplier = await buildAdjustmentLookup(
    studentId,
    candidates.map((c) => c.type)
  );
  const ranked = rankAndScore(candidates, getAdjustmentMultiplier);

  const existingActive = await recommendationRepository.findAllActiveDedupeKeys(studentId);
  const rankedDedupeKeys = new Set(ranked.map((c) => c.dedupeKey));

  const persisted = [];
  for (const candidate of ranked) {
    const expiresAt = resolveExpiresAt(candidate, context.now);
    const row = await recommendationRepository.upsertCandidate(studentId, candidate, expiresAt);
    persisted.push(row);
    await analyticsRepository.increment(candidate.type, "generatedCount", context.now);
  }

  // Anything still ACTIVE but not regenerated this cycle no longer applies
  // (e.g. the underlying knowledge gap closed, or the deadline passed) —
  // respects explicit DISMISSED feedback by construction: only rows this
  // query returns (status=ACTIVE) are touched, dismissed ones are skipped.
  const toRetire = existingActive.filter((row) => !rankedDedupeKeys.has(row.dedupeKey));
  for (const row of toRetire) {
    const full = await recommendationRepository.findById(row.id);
    if (full) await retireRecommendation(full, RETIRED_REASON.SUPERSEDED);
  }

  recommendationBus.publish(RECOMMENDATION_EVENT_NAMES.RECOMMENDATION_UPDATED, {
    studentId,
    trigger,
    count: persisted.length,
    timestamp: context.now,
  });

  return { studentId, generated: persisted.length, retired: toRetire.length };
};

const recalculate = (studentId) => generateForStudent(studentId, "manual-recalculate");

const getByStudent = async (studentId) => {
  const recommendations = await recommendationRepository.findActiveByStudent(studentId);
  return toRecommendationListResponse(studentId, recommendations);
};

const getToday = async (studentId) => {
  const recommendations = await recommendationRepository.findActiveByStudent(studentId);
  const dailyTask = recommendations.find((r) => r.type === "DAILY_LEARNING_TASKS") || null;
  const highPriorityToday = recommendations.filter((r) => r.priority === "HIGH");
  return toTodayResponse(studentId, { dailyTask, highPriorityToday });
};

const getHighPriority = async (studentId) => {
  const recommendations = await recommendationRepository.findActiveByStudent(studentId, { priority: "HIGH" });
  return toRecommendationListResponse(studentId, recommendations);
};

const getRevision = async (studentId) => {
  const all = await recommendationRepository.findActiveByStudent(studentId);
  return toRecommendationListResponse(studentId, all.filter((r) => REVISION_TYPES.includes(r.type)));
};

const getLearning = async (studentId) => {
  const all = await recommendationRepository.findActiveByStudent(studentId);
  return toRecommendationListResponse(studentId, all.filter((r) => LEARNING_TYPES.includes(r.type)));
};

/**
 * Batch read for cross-agent consumers aggregating many students at once
 * (e.g. Teacher Insight's class-wide reads) — one query instead of N.
 * Returns the flat, unshaped rows (not the DTO) since class-wide
 * aggregation groups by type/priority across students, not per student.
 *
 * @param {string[]} studentIds
 */
const getBatchActiveRecommendations = async (studentIds) => {
  if (studentIds.length === 0) return [];
  return recommendationRepository.findActiveByStudents(studentIds);
};

const ANALYTICS_FIELD_BY_ACTION = {
  [FEEDBACK_ACTION.HELPFUL]: null,
  [FEEDBACK_ACTION.NOT_HELPFUL]: null,
  [FEEDBACK_ACTION.DISMISSED]: "dismissedCount",
  [FEEDBACK_ACTION.ACCEPTED]: "acceptedCount",
  [FEEDBACK_ACTION.COMPLETED]: "completedCount",
};

/**
 * Records feedback and, for DISMISSED/COMPLETED, transitions the live
 * recommendation's status accordingly (with a history snapshot) — HELPFUL/
 * NOT_HELPFUL/ACCEPTED only feed future scoring via feedbackAdjustment,
 * they don't change the recommendation's own lifecycle.
 */
const recordFeedback = async (studentId, { recommendationId, action, comment }) => {
  const recommendation = await recommendationRepository.findById(recommendationId);
  if (!recommendation || recommendation.studentId !== studentId) {
    throw new ApiError(404, "Recommendation not found");
  }

  const feedback = await feedbackRepository.create({ recommendationId, studentId, action, comment });

  const analyticsField = ANALYTICS_FIELD_BY_ACTION[action];
  if (analyticsField) await analyticsRepository.increment(recommendation.type, analyticsField);

  if (action === FEEDBACK_ACTION.DISMISSED && recommendation.status === RECOMMENDATION_STATUS.ACTIVE) {
    await retireRecommendation(recommendation, RETIRED_REASON.DISMISSED);
  } else if (action === FEEDBACK_ACTION.COMPLETED && recommendation.status === RECOMMENDATION_STATUS.ACTIVE) {
    await retireRecommendation(recommendation, RETIRED_REASON.COMPLETED);
  }

  return toFeedbackResponse(feedback);
};

/** Used by schedulers/dailyDigest.scheduler.js to sweep time-based expiry. */
const expireStaleRecommendations = async (now = new Date()) => {
  const expired = await recommendationRepository.findExpiredActive(now);
  for (const row of expired) {
    await retireRecommendation(row, RETIRED_REASON.EXPIRED);
  }
  return expired.length;
};

module.exports = {
  generateForStudent,
  recalculate,
  getByStudent,
  getToday,
  getHighPriority,
  getRevision,
  getLearning,
  getBatchActiveRecommendations,
  recordFeedback,
  expireStaleRecommendations,
};
