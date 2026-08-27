const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY, INACTIVITY_MEDIUM_DAYS, INACTIVITY_HIGH_DAYS } = require("../../../constants");
const { daysBetween } = require("../../../utils/scoreMath.util");

/**
 * INACTIVITY_ALERT: fires once the student has been idle beyond
 * INACTIVITY_MEDIUM_DAYS. Deliberately skipped when the burnout heuristic
 * already fired for this student this cycle — a burned-out student who
 * stops isn't "inactive" in the same sense, and personalizedEncouragement
 * already covers that case with a softer tone (see motivation.service.js's
 * orchestration order).
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @param {boolean} isBurnedOut
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context, isBurnedOut) => {
  if (isBurnedOut) return [];

  const lastActiveAt = context.learningState?.engagement?.lastActiveAt;
  if (!lastActiveAt) return [];

  const idleDays = daysBetween(context.now, new Date(lastActiveAt));
  if (idleDays < INACTIVITY_MEDIUM_DAYS) return [];

  const priority = idleDays >= INACTIVITY_HIGH_DAYS ? MOTIVATION_PRIORITY.HIGH : MOTIVATION_PRIORITY.MEDIUM;

  return [
    {
      type: MOTIVATION_ACTION_TYPE.INACTIVITY_ALERT,
      dedupeKey: "general",
      priority,
      triggerReason: `It's been ${Math.round(idleDays)} day(s) since your last activity — pick a small task to get back on track.`,
      confidence: 85,
      recommendedAt: context.now,
      metadata: { idleDays: Math.round(idleDays) },
    },
  ];
};

module.exports = { detect };
