const prisma = require("../../../config/database");
const { defaultAggregate } = require("../constants/defaultDomainState.constants");

const rootRepo = require("./studentLearningState.repository");
const progressRepo = require("./studentProgress.repository");
const performanceRepo = require("./studentPerformance.repository");
const engagementRepo = require("./studentEngagement.repository");
const behaviorRepo = require("./studentBehavior.repository");
const riskRepo = require("./studentRisk.repository");

/**
 * Facade over the six per-domain repositories: composes reads into one
 * aggregate, and writes all six tables atomically in a single transaction
 * so a partial update (e.g. progress saved but risk lost on crash) can
 * never happen.
 */

const mapPerformance = (row) => ({
  quizAttemptsCount: row.quizAttemptsCount,
  quizSumScorePercent: row.quizSumScorePercent,
  quizAverage: row.quizAverage,
  quizPassCount: row.quizPassCount,
  passRate: row.passRate,
  assignmentAttemptsCount: row.assignmentAttemptsCount,
  assignmentScoredCount: row.assignmentScoredCount,
  assignmentSumScorePercent: row.assignmentSumScorePercent,
  assignmentAverage: row.assignmentAverage,
  correctAnswersCount: row.correctAnswersCount,
  totalAnswersCount: row.totalAnswersCount,
  accuracy: row.accuracy,
  recentQuizScores: row.recentQuizScores || [],
  improvementTrend: row.improvementTrend,
  topicStats: row.topicStats || {},
  weakTopics: row.weakTopics || [],
  strongTopics: row.strongTopics || [],
});

const mapBehavior = (row) => ({
  rewatchCount: row.rewatchCount,
  lessonSkipCount: row.lessonSkipCount,
  quizRetryCount: row.quizRetryCount,
  aiHelpRequestCount: row.aiHelpRequestCount,
  startedQuizIds: row.startedQuizIds || [],
  hourHistogram: row.hourHistogram || new Array(24).fill(0),
  preferredLearningHour: row.preferredLearningHour,
  preferredStudyDurationSeconds: row.preferredStudyDurationSeconds,
  preferredLearningSpeed: row.preferredLearningSpeed,
  speedSumForAvg: row.speedSumForAvg,
  speedSampleCount: row.speedSampleCount,
  lastPlayedContentId: row.lastPlayedContentId,
  lastStartedLessonId: row.lastStartedLessonId,
  lastStartedLessonCompleted: row.lastStartedLessonCompleted,
});

/**
 * @param {string} studentId
 * @returns {Promise<import("../types/studentState.types").StudentStateAggregate & {isNew: boolean, id: string|null}>}
 */
const getAggregate = async (studentId) => {
  const root = await rootRepo.findRootWithRelations(studentId);

  if (!root) {
    return { ...defaultAggregate(studentId), id: null, isNew: true };
  }

  return {
    id: root.id,
    isNew: false,
    studentId,
    state: {
      overallLearningScore: root.overallLearningScore,
      engagementScore: root.engagementScore,
      performanceScore: root.performanceScore,
      consistencyScore: root.consistencyScore,
      learningHealthScore: root.learningHealthScore,
      lastEventId: root.lastEventId,
      lastEventAt: root.lastEventAt,
      lastRecalculatedAt: root.lastRecalculatedAt,
      version: root.version,
    },
    progress: root.progress,
    performance: mapPerformance(root.performance),
    engagement: root.engagement,
    behavior: mapBehavior(root.behavior),
    risk: root.risk,
  };
};

/**
 * Atomically persists all six tables for one student.
 * @param {import("../types/studentState.types").StudentStateAggregate} aggregate
 */
const saveAggregate = async (aggregate) => {
  return prisma.$transaction(async (tx) => {
    const root = await rootRepo.upsertRoot(aggregate.studentId, aggregate.state, tx);

    await Promise.all([
      progressRepo.upsertByStateId(root.id, aggregate.progress, tx),
      performanceRepo.upsertByStateId(root.id, aggregate.performance, tx),
      engagementRepo.upsertByStateId(root.id, aggregate.engagement, tx),
      behaviorRepo.upsertByStateId(root.id, aggregate.behavior, tx),
      riskRepo.upsertByStateId(root.id, aggregate.risk, tx),
    ]);

    return root.id;
  });
};

const findRecentlyActiveStudentIds = (sinceDate) => rootRepo.findRecentlyActiveStudentIds(sinceDate);

/**
 * Batch counterpart to getAggregate — one query instead of N, for
 * consumers aggregating many students at once (e.g. Teacher Insight's
 * class-wide reads). Students with no state yet are simply absent from the
 * result rather than padded with defaults — the caller already knows which
 * studentIds it asked for.
 *
 * @param {string[]} studentIds
 * @returns {Promise<Array<import("../types/studentState.types").StudentStateAggregate & {id: string}>>}
 */
const getBatchAggregates = async (studentIds) => {
  if (studentIds.length === 0) return [];
  const roots = await rootRepo.findManyWithRelations(studentIds);

  return roots.map((root) => ({
    id: root.id,
    studentId: root.studentId,
    state: {
      overallLearningScore: root.overallLearningScore,
      engagementScore: root.engagementScore,
      performanceScore: root.performanceScore,
      consistencyScore: root.consistencyScore,
      learningHealthScore: root.learningHealthScore,
      lastEventId: root.lastEventId,
      lastEventAt: root.lastEventAt,
      lastRecalculatedAt: root.lastRecalculatedAt,
      version: root.version,
    },
    progress: root.progress,
    performance: mapPerformance(root.performance),
    engagement: root.engagement,
    behavior: mapBehavior(root.behavior),
    risk: root.risk,
  }));
};

module.exports = {
  getAggregate,
  saveAggregate,
  getBatchAggregates,
  findRecentlyActiveStudentIds,
};
