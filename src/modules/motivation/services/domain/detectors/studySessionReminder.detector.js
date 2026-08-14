const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY, LOW_DAILY_STUDY_SECONDS, INACTIVITY_MEDIUM_DAYS } = require("../../../constants");
const { daysBetween } = require("../../../utils/scoreMath.util");

/**
 * STUDY_SESSION_REMINDER: "suggest short study sessions" — for a student
 * who's still active (not yet crossing into inactivityAlert territory) but
 * whose daily study time has dropped low. A lighter-touch nudge than
 * INACTIVITY_ALERT, deliberately mutually exclusive with it (only fires
 * while idleDays is below the inactivity threshold).
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context) => {
  const engagement = context.learningState?.engagement;
  if (!engagement?.lastActiveAt) return [];

  const idleDays = daysBetween(context.now, new Date(engagement.lastActiveAt));
  if (idleDays >= INACTIVITY_MEDIUM_DAYS) return []; // inactivityAlert already covers this

  if ((engagement.dailyStudyTimeSeconds || 0) >= LOW_DAILY_STUDY_SECONDS) return [];

  return [
    {
      type: MOTIVATION_ACTION_TYPE.STUDY_SESSION_REMINDER,
      dedupeKey: "general",
      priority: MOTIVATION_PRIORITY.LOW,
      triggerReason: "Even a 10-minute session today keeps your momentum going.",
      confidence: 55,
      recommendedAt: context.now,
      metadata: { dailyStudyTimeSeconds: engagement.dailyStudyTimeSeconds || 0 },
    },
  ];
};

module.exports = { detect };
