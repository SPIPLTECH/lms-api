const { BURNOUT_QUIZ_RETRY_THRESHOLD, BURNOUT_AI_HELP_THRESHOLD, BURNOUT_DAILY_STUDY_SECONDS, TRENDS } = require("../../constants");

/**
 * Distinguishes "burned out" from plain "disengaged" — both can look like
 * declining performance, but the right response is opposite (ease off vs.
 * push a nudge). Burnout requires evidence of sustained effort (high study
 * time, elevated retries/help-requests) alongside flat-or-declining
 * performance; disengagement is declining performance without that effort
 * evidence, which inactivityAlert/personalizedEncouragement handle instead.
 *
 * @param {Object} params
 * @param {number} params.quizRetryCount
 * @param {number} params.aiHelpRequestCount
 * @param {number} params.dailyStudyTimeSeconds
 * @param {string} params.performanceTrend - TRENDS value.
 * @returns {boolean}
 */
const isLikelyBurnout = ({ quizRetryCount, aiHelpRequestCount, dailyStudyTimeSeconds, performanceTrend }) => {
  const highEffort =
    quizRetryCount >= BURNOUT_QUIZ_RETRY_THRESHOLD ||
    aiHelpRequestCount >= BURNOUT_AI_HELP_THRESHOLD ||
    dailyStudyTimeSeconds >= BURNOUT_DAILY_STUDY_SECONDS;

  const flatOrDeclining = performanceTrend === TRENDS.DECLINING || performanceTrend === TRENDS.STABLE;

  return highEffort && flatOrDeclining;
};

module.exports = { isLikelyBurnout };
