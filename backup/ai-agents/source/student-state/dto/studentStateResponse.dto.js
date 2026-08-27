/**
 * Full state: every field, for other agents/system integrations that need
 * the whole record (e.g. a Recommendation Agent reading everything).
 */
const toFullStateResponse = (aggregate) => ({
  studentId: aggregate.studentId,
  scores: {
    overallLearningScore: aggregate.state.overallLearningScore,
    engagementScore: aggregate.state.engagementScore,
    performanceScore: aggregate.state.performanceScore,
    consistencyScore: aggregate.state.consistencyScore,
    learningHealthScore: aggregate.state.learningHealthScore,
  },
  progress: aggregate.progress,
  performance: aggregate.performance,
  engagement: aggregate.engagement,
  behavior: aggregate.behavior,
  risk: aggregate.risk,
  lastEventId: aggregate.state.lastEventId,
  lastEventAt: aggregate.state.lastEventAt,
  lastRecalculatedAt: aggregate.state.lastRecalculatedAt,
  version: aggregate.state.version,
});

/**
 * Curated, presentation-friendly summary: the handful of fields a
 * student-facing dashboard or a quick-glance teacher view actually needs.
 */
const toDashboardResponse = (aggregate) => ({
  studentId: aggregate.studentId,
  scores: {
    overallLearningScore: aggregate.state.overallLearningScore,
    engagementScore: aggregate.state.engagementScore,
    performanceScore: aggregate.state.performanceScore,
    consistencyScore: aggregate.state.consistencyScore,
    learningHealthScore: aggregate.state.learningHealthScore,
  },
  progress: {
    currentCourseId: aggregate.progress.currentCourseId,
    currentModuleId: aggregate.progress.currentModuleId,
    currentLessonId: aggregate.progress.currentLessonId,
    courseCompletionPercent: aggregate.progress.courseCompletionPercent,
  },
  performance: {
    quizAverage: aggregate.performance.quizAverage,
    passRate: aggregate.performance.passRate,
    improvementTrend: aggregate.performance.improvementTrend,
    weakTopics: aggregate.performance.weakTopics,
    strongTopics: aggregate.performance.strongTopics,
  },
  engagement: {
    dailyStudyTimeSeconds: aggregate.engagement.dailyStudyTimeSeconds,
    loginStreakDays: aggregate.engagement.loginStreakDays,
    lastActiveAt: aggregate.engagement.lastActiveAt,
  },
  risk: {
    dropoutRiskLevel: aggregate.risk.dropoutRiskLevel,
    dropoutRiskScore: aggregate.risk.dropoutRiskScore,
  },
  lastEventAt: aggregate.state.lastEventAt,
});

const DOMAIN_KEYS = new Set(["progress", "performance", "engagement", "behavior", "risk"]);

/** @param {"progress"|"performance"|"engagement"|"behavior"|"risk"} domain */
const toDomainSliceResponse = (aggregate, domain) => {
  if (!DOMAIN_KEYS.has(domain)) {
    throw new Error(`Unknown student-state domain: ${domain}`);
  }

  return {
    studentId: aggregate.studentId,
    [domain]: aggregate[domain],
    updatedAt: aggregate.state.lastEventAt,
  };
};

module.exports = {
  toFullStateResponse,
  toDashboardResponse,
  toDomainSliceResponse,
};
