/**
 * @typedef {Object} StudentStateAggregate
 * @property {string} studentId
 * @property {import("./studentState.types").StateFields} state
 * @property {import("./studentState.types").ProgressState} progress
 * @property {import("./studentState.types").PerformanceState} performance
 * @property {import("./studentState.types").EngagementState} engagement
 * @property {import("./studentState.types").BehaviorState} behavior
 * @property {import("./studentState.types").RiskState} risk
 */

/**
 * @typedef {Object} StateFields
 * @property {number} overallLearningScore
 * @property {number} engagementScore
 * @property {number} performanceScore
 * @property {number} consistencyScore
 * @property {number} learningHealthScore
 * @property {string|null} lastEventId
 * @property {Date|null} lastEventAt
 * @property {Date|null} lastRecalculatedAt
 * @property {number} version
 */

/**
 * @typedef {Object} ProgressState
 * @property {string|null} currentCourseId
 * @property {string|null} currentModuleId
 * @property {string|null} currentLessonId
 * @property {number} courseCompletionPercent
 * @property {number} moduleCompletionPercent
 * @property {number} lessonCompletionPercent
 * @property {number} videoProgressPercent
 * @property {number} readingProgressPercent
 * @property {number} coursesCompletedCount
 * @property {number} modulesCompletedCount
 * @property {number} lessonsCompletedCount
 */

/**
 * @typedef {Object} PerformanceState
 * @property {number} quizAttemptsCount
 * @property {number} quizSumScorePercent
 * @property {number} quizAverage
 * @property {number} quizPassCount
 * @property {number} passRate
 * @property {number} assignmentAttemptsCount
 * @property {number} assignmentScoredCount
 * @property {number} assignmentSumScorePercent
 * @property {number} assignmentAverage
 * @property {number} correctAnswersCount
 * @property {number} totalAnswersCount
 * @property {number} accuracy
 * @property {number[]} recentQuizScores
 * @property {"IMPROVING"|"DECLINING"|"STABLE"} improvementTrend
 * @property {Record<string, {correct: number, total: number}>} topicStats
 * @property {string[]} weakTopics
 * @property {string[]} strongTopics
 */

/**
 * @typedef {Object} EngagementState
 * @property {number} dailyStudyTimeSeconds
 * @property {number} weeklyStudyTimeSeconds
 * @property {number} totalStudyTimeSeconds
 * @property {number} loginStreakDays
 * @property {number} longestLoginStreakDays
 * @property {number} consecutiveLearningDays
 * @property {Date|null} lastActiveAt
 * @property {Date|null} lastActiveDate
 * @property {Date|null} lastLoginDate
 * @property {Date|null} dailyBucketDate
 * @property {Date|null} weeklyBucketStart
 * @property {number} sessionCount
 * @property {number} totalSessionDurationSeconds
 * @property {number} averageSessionDurationSeconds
 * @property {string|null} currentSessionId
 * @property {Date|null} currentSessionStartedAt
 */

/**
 * @typedef {Object} BehaviorState
 * @property {number} rewatchCount
 * @property {number} lessonSkipCount
 * @property {number} quizRetryCount
 * @property {number} aiHelpRequestCount
 * @property {string[]} startedQuizIds
 * @property {number[]} hourHistogram
 * @property {number|null} preferredLearningHour
 * @property {number|null} preferredStudyDurationSeconds
 * @property {"SLOW"|"NORMAL"|"FAST"|null} preferredLearningSpeed
 * @property {number} speedSumForAvg
 * @property {number} speedSampleCount
 * @property {string|null} lastPlayedContentId
 * @property {string|null} lastStartedLessonId
 * @property {boolean} lastStartedLessonCompleted
 */

/**
 * @typedef {Object} RiskState
 * @property {number} inactivityDays
 * @property {number} inactivityScore
 * @property {boolean} lowEngagementFlag
 * @property {number} dropoutRiskScore
 * @property {"LOW"|"MEDIUM"|"HIGH"} dropoutRiskLevel
 * @property {number} deadlineRiskScore
 * @property {Date|null} pendingAssignmentStartedAt
 * @property {number} completionProbability
 */

module.exports = {};
