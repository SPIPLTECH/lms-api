const ApiError = require("../../../utils/ApiError");

const learningPathRepository = require("../repositories/learningPath.repository");
const learningRecommendationRepository = require("../repositories/learningRecommendation.repository");
const studyPlanRepository = require("../repositories/studyPlan.repository");
const learningMilestoneRepository = require("../repositories/learningMilestone.repository");
const revisionPlanRepository = require("../repositories/revisionPlan.repository");

const { buildContext } = require("./context/studentContextBuilder");
const { buildSequence, findNextItem, remainingItems } = require("./domain/sequencer");
const { personalizeSequence } = require("./domain/pathPersonalizer");
const { determinePace } = require("./domain/paceAdjuster");
const { estimateCompletionDate } = require("./domain/completionEstimator");
const { buildWeeklyPlan, buildDailyPlan } = require("./domain/studyPlanBuilder");
const { generateMilestones } = require("./domain/milestoneGenerator");
const { detectRevisionTopics } = require("./domain/revisionDetector");
const { buildRecommendations } = require("./domain/recommendationBuilder");

const { learningPathBus } = require("../events/eventBus");
const { LEARNING_PATH_EVENT_NAMES } = require("../events/eventNames");

const { startOfWeek, startOfDay, addDays } = require("../utils/dateMath.util");

const { RECOMMENDATION_STATUS, STUDY_PLAN_TYPE, DIFFICULTY_ADJUSTMENT, DEFAULT_DAILY_STUDY_MINUTES, WEEKLY_PLAN_DAYS } = require("../constants");

const {
  toPathResponse,
  toNextResponse,
  toStudyPlanResponse,
  toRecommendationListResponse,
  toMilestoneListResponse,
  toRecalculateResponse,
} = require("../dto/learningPathResponse.dto");

const persistEmptyPath = (studentId, now) =>
  learningPathRepository.upsert(
    studentId,
    {
      currentCourseId: null,
      nextLessonId: null,
      nextModuleId: null,
      recommendedLearningOrder: [],
      priorityTopics: [],
      difficultyAdjustment: DIFFICULTY_ADJUSTMENT.STANDARD,
      suggestedStudyMinutesPerDay: DEFAULT_DAILY_STUDY_MINUTES,
      estimatedCompletionDate: null,
    },
    now
  );

const resolveBaseDailyMinutes = (engagement, behavior) => {
  if (engagement.dailyStudyTimeSeconds) return Math.round(engagement.dailyStudyTimeSeconds / 60);
  if (behavior.preferredStudyDurationSeconds) return Math.round(behavior.preferredStudyDurationSeconds / 60);
  return DEFAULT_DAILY_STUDY_MINUTES;
};

/**
 * The core pipeline: Fetch Student Profile -> Analyze Progress -> Analyze
 * Weak Topics -> Analyze Learning Behavior -> Analyze Course Structure ->
 * Generate Personalized Path -> Save Learning Path -> Publish
 * LearningPathUpdated. Called on every trigger (debounced
 * student-state:updated, the daily sweep, or an explicit
 * POST /learning-path/recalculate).
 *
 * @param {string} studentId
 * @param {string} [trigger] - for logging only.
 */
const generateForStudent = async (studentId, trigger = "manual") => {
  const context = await buildContext(studentId);

  if (!context.currentCourseId || !context.courseStructure || context.courseStructure.length === 0) {
    await persistEmptyPath(studentId, context.now);
    learningPathBus.publish(LEARNING_PATH_EVENT_NAMES.PATH_UPDATED, { studentId, trigger, timestamp: context.now });
    return { studentId, hasActiveCourse: false, recommendationsGenerated: 0, retired: 0, milestonesGenerated: 0, revisionTopicsOpen: 0 };
  }

  const sequence = buildSequence(context.courseStructure, context.progressByLessonId);
  const nextItem = findNextItem(sequence);
  const remaining = remainingItems(sequence);

  const behavior = context.learningState?.behavior || {};
  const performance = context.learningState?.performance || {};
  const engagement = context.learningState?.engagement || {};

  const { difficultyAdjustment, suggestedStudyMinutesPerDay } = determinePace({
    preferredLearningSpeed: behavior.preferredLearningSpeed || null,
    passRate: performance.passRate || 0,
    improvementTrend: performance.improvementTrend || "STABLE",
    baseDailyMinutes: resolveBaseDailyMinutes(engagement, behavior),
  });

  const estimatedCompletionDate = estimateCompletionDate(remaining, suggestedStudyMinutesPerDay, context.now);
  const priorityTopics = performance.weakTopics || [];

  // AI Student Entry Phase: annotate with recommendedMode/recommendedMinutes/
  // aiPersonalizationReason when this student has a completed entry
  // assessment for the current course — see domain/pathPersonalizer.js.
  // Only recommendedLearningOrder is enriched; `remaining` itself (used
  // below for milestones/recommendations/study plans) stays untouched.
  const personalizedRemaining = personalizeSequence(remaining, context.courseState);

  await learningPathRepository.upsert(
    studentId,
    {
      currentCourseId: context.currentCourseId,
      nextLessonId: nextItem?.lessonId || null,
      nextModuleId: nextItem?.moduleId || null,
      recommendedLearningOrder: personalizedRemaining,
      priorityTopics,
      difficultyAdjustment,
      suggestedStudyMinutesPerDay,
      estimatedCompletionDate,
    },
    context.now
  );

  const milestones = generateMilestones(context.courseStructure, sequence, suggestedStudyMinutesPerDay, context.now, context.currentCourseId);
  for (const milestone of milestones) {
    await learningMilestoneRepository.upsertCandidate(studentId, context.currentCourseId, milestone);
  }

  const revisionTopics = detectRevisionTopics(priorityTopics, context.currentCourseId);
  const existingPendingRevisions = await revisionPlanRepository.findAllPendingKeys(studentId);
  const currentTopicNames = new Set(revisionTopics.map((r) => r.topic));
  for (const revision of revisionTopics) {
    await revisionPlanRepository.upsertCandidate(studentId, revision);
  }
  for (const row of existingPendingRevisions.filter((r) => !currentTopicNames.has(r.topic))) {
    await revisionPlanRepository.markCompleted(row.id);
  }

  const candidates = buildRecommendations({
    nextItem,
    sequence,
    courseId: context.currentCourseId,
    revisionTopics,
    difficultyAdjustment,
    currentLessonId: context.learningState?.progress?.currentLessonId || null,
  });

  const existingActiveKeys = await learningRecommendationRepository.findAllActiveDedupeKeys(studentId);
  const candidateDedupeKeys = new Set(candidates.map((c) => c.dedupeKey));

  const persisted = [];
  for (const candidate of candidates) {
    persisted.push(await learningRecommendationRepository.upsertCandidate(studentId, candidate));
  }

  // Anything still ACTIVE but not regenerated this cycle no longer applies (e.g. the student caught up, or the weak topic resolved).
  const toRetire = existingActiveKeys.filter((row) => !candidateDedupeKeys.has(row.dedupeKey));
  for (const row of toRetire) {
    await learningRecommendationRepository.updateStatus(row.id, RECOMMENDATION_STATUS.EXPIRED);
  }

  const weeklyDays = buildWeeklyPlan(remaining, suggestedStudyMinutesPerDay, context.now);
  const dailyDay = buildDailyPlan(weeklyDays);

  const weekStart = startOfWeek(context.now);
  await studyPlanRepository.upsert(studentId, STUDY_PLAN_TYPE.WEEKLY, weekStart, {
    periodEnd: addDays(weekStart, WEEKLY_PLAN_DAYS - 1),
    scheduledItems: weeklyDays,
    suggestedStudyMinutes: suggestedStudyMinutesPerDay,
  });

  const todayStart = startOfDay(context.now);
  await studyPlanRepository.upsert(studentId, STUDY_PLAN_TYPE.DAILY, todayStart, {
    periodEnd: todayStart,
    scheduledItems: dailyDay.items,
    suggestedStudyMinutes: dailyDay.totalMinutes,
  });

  learningPathBus.publish(LEARNING_PATH_EVENT_NAMES.PATH_UPDATED, {
    studentId,
    trigger,
    nextLessonId: nextItem?.lessonId || null,
    timestamp: context.now,
  });

  return {
    studentId,
    hasActiveCourse: true,
    recommendationsGenerated: persisted.length,
    retired: toRetire.length,
    milestonesGenerated: milestones.length,
    revisionTopicsOpen: revisionTopics.length,
  };
};

const recalculate = (studentId) => generateForStudent(studentId, "manual-recalculate").then(toRecalculateResponse);

const requirePath = async (studentId) => {
  const path = await learningPathRepository.findByStudent(studentId);
  if (!path) throw new ApiError(404, "No learning path calculated yet for this student — call POST /learning-path/recalculate first");
  return path;
};

const getProfile = async (studentId) => toPathResponse(await requirePath(studentId));

const getNext = async (studentId) => toNextResponse(await requirePath(studentId));

const requireStudyPlan = async (studentId, planType, notFoundMessage) => {
  const plan = await studyPlanRepository.findLatestByStudentAndType(studentId, planType);
  if (!plan) throw new ApiError(404, notFoundMessage);
  return plan;
};

const getDailyPlan = async (studentId) =>
  toStudyPlanResponse(
    await requireStudyPlan(studentId, STUDY_PLAN_TYPE.DAILY, "No daily study plan calculated yet for this student — call POST /learning-path/recalculate first")
  );

const getWeeklyPlan = async (studentId) =>
  toStudyPlanResponse(
    await requireStudyPlan(
      studentId,
      STUDY_PLAN_TYPE.WEEKLY,
      "No weekly study plan calculated yet for this student — call POST /learning-path/recalculate first"
    )
  );

const getRecommendations = async (studentId, type) => {
  const recommendations = await learningRecommendationRepository.findActiveByStudent(studentId, { type });
  return toRecommendationListResponse(studentId, recommendations);
};

const getMilestones = async (studentId, courseId) => {
  const milestones = await learningMilestoneRepository.findByStudent(studentId, { courseId });
  return toMilestoneListResponse(studentId, milestones);
};

const toCrossAgentShape = (path) => ({
  studentId: path.studentId,
  currentCourseId: path.currentCourseId,
  nextLessonId: path.nextLessonId,
  nextModuleId: path.nextModuleId,
  recommendedLearningOrder: path.recommendedLearningOrder,
  priorityTopics: path.priorityTopics,
  difficultyAdjustment: path.difficultyAdjustment,
  suggestedStudyMinutesPerDay: path.suggestedStudyMinutesPerDay,
  estimatedCompletionDate: path.estimatedCompletionDate,
  version: path.version,
  lastCalculatedAt: path.lastCalculatedAt,
});

/**
 * Trusted, single-student read for other agents (Recommendation, Assessment,
 * Motivation already call this defensively). Returns null rather than
 * throwing when no path exists yet — absence is a normal case for a
 * cross-agent caller, not an error.
 */
const getFullState = async (studentId) => {
  const path = await learningPathRepository.findByStudent(studentId);
  return path ? toCrossAgentShape(path) : null;
};

/**
 * Batch counterpart to getFullState, for consumers aggregating many
 * students at once (Teacher Insight's class-wide reads). One query instead
 * of N. Students with no path yet are simply absent, not padded with
 * defaults.
 *
 * @param {string[]} studentIds
 */
const getBatchStates = async (studentIds) => {
  if (studentIds.length === 0) return [];
  const paths = await learningPathRepository.findByStudents(studentIds);
  return paths.map(toCrossAgentShape);
};

module.exports = {
  generateForStudent,
  recalculate,
  getProfile,
  getNext,
  getDailyPlan,
  getWeeklyPlan,
  getRecommendations,
  getMilestones,
  getFullState,
  getBatchStates,
};
