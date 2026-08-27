/**
 * Zero-value shape for each domain slice — what a brand-new student's
 * state looks like before any event has been processed. Mirrors the
 * Prisma model defaults exactly; repository maps rows to/from this shape.
 */

const defaultProgressState = () => ({
  currentCourseId: null,
  currentModuleId: null,
  currentLessonId: null,
  courseCompletionPercent: 0,
  moduleCompletionPercent: 0,
  lessonCompletionPercent: 0,
  videoProgressPercent: 0,
  readingProgressPercent: 0,
  coursesCompletedCount: 0,
  modulesCompletedCount: 0,
  lessonsCompletedCount: 0,
});

const defaultPerformanceState = () => ({
  quizAttemptsCount: 0,
  quizSumScorePercent: 0,
  quizAverage: 0,
  quizPassCount: 0,
  passRate: 0,
  assignmentAttemptsCount: 0,
  assignmentScoredCount: 0,
  assignmentSumScorePercent: 0,
  assignmentAverage: 0,
  correctAnswersCount: 0,
  totalAnswersCount: 0,
  accuracy: 0,
  recentQuizScores: [],
  improvementTrend: "STABLE",
  topicStats: {},
  weakTopics: [],
  strongTopics: [],
});

const defaultEngagementState = () => ({
  dailyStudyTimeSeconds: 0,
  weeklyStudyTimeSeconds: 0,
  totalStudyTimeSeconds: 0,
  loginStreakDays: 0,
  longestLoginStreakDays: 0,
  consecutiveLearningDays: 0,
  lastActiveAt: null,
  lastActiveDate: null,
  lastLoginDate: null,
  dailyBucketDate: null,
  weeklyBucketStart: null,
  sessionCount: 0,
  totalSessionDurationSeconds: 0,
  averageSessionDurationSeconds: 0,
  currentSessionId: null,
  currentSessionStartedAt: null,
});

const defaultBehaviorState = () => ({
  rewatchCount: 0,
  lessonSkipCount: 0,
  quizRetryCount: 0,
  aiHelpRequestCount: 0,
  startedQuizIds: [],
  hourHistogram: new Array(24).fill(0),
  preferredLearningHour: null,
  preferredStudyDurationSeconds: null,
  preferredLearningSpeed: null,
  speedSumForAvg: 0,
  speedSampleCount: 0,
  lastPlayedContentId: null,
  lastStartedLessonId: null,
  lastStartedLessonCompleted: false,
});

const defaultRiskState = () => ({
  inactivityDays: 0,
  inactivityScore: 0,
  lowEngagementFlag: false,
  dropoutRiskScore: 0,
  dropoutRiskLevel: "LOW",
  deadlineRiskScore: 0,
  pendingAssignmentStartedAt: null,
  completionProbability: 0,
});

const defaultStateFields = () => ({
  overallLearningScore: 0,
  engagementScore: 0,
  performanceScore: 0,
  consistencyScore: 0,
  learningHealthScore: 0,
  lastEventId: null,
  lastEventAt: null,
  lastRecalculatedAt: null,
  version: 0,
});

const defaultAggregate = (studentId) => ({
  studentId,
  state: defaultStateFields(),
  progress: defaultProgressState(),
  performance: defaultPerformanceState(),
  engagement: defaultEngagementState(),
  behavior: defaultBehaviorState(),
  risk: defaultRiskState(),
});

module.exports = {
  defaultProgressState,
  defaultPerformanceState,
  defaultEngagementState,
  defaultBehaviorState,
  defaultRiskState,
  defaultStateFields,
  defaultAggregate,
};
