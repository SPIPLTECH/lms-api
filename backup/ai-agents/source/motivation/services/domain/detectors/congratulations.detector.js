const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY, CELEBRATION_EVENT_TYPES } = require("../../../constants");

const CELEBRATION_EVENT_TYPE_SET = new Set(CELEBRATION_EVENT_TYPES);

const labelFor = (eventType) =>
  ({
    COURSE_COMPLETED: "completing the course",
    MODULE_COMPLETED: "completing the module",
    LESSON_COMPLETED: "completing the lesson",
    QUIZ_COMPLETED: "finishing the quiz",
  })[eventType] || "your progress";

/**
 * CONGRATULATIONS_MESSAGE: fires on a genuine completion signal in the
 * recent event slice — short-lived and specific, not a general "good job."
 * Picks the single most significant completion this cycle (course > module
 * > lesson > quiz) rather than one per event, since several completions
 * often land in the same batch (e.g. a lesson completing its module).
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const SIGNIFICANCE_ORDER = ["COURSE_COMPLETED", "MODULE_COMPLETED", "LESSON_COMPLETED", "QUIZ_COMPLETED"];

const detect = (context) => {
  const recentCompletions = (context.recentEvents || []).filter((e) => CELEBRATION_EVENT_TYPE_SET.has(e.eventType));
  if (recentCompletions.length === 0) return [];

  const mostSignificant = recentCompletions.reduce((best, event) => {
    if (!best) return event;
    return SIGNIFICANCE_ORDER.indexOf(event.eventType) < SIGNIFICANCE_ORDER.indexOf(best.eventType) ? event : best;
  }, null);

  return [
    {
      type: MOTIVATION_ACTION_TYPE.CONGRATULATIONS_MESSAGE,
      dedupeKey: mostSignificant.id,
      priority: MOTIVATION_PRIORITY.LOW,
      triggerReason: `Nice work ${labelFor(mostSignificant.eventType)}!`,
      confidence: 90,
      recommendedAt: context.now,
      courseId: mostSignificant.courseId || undefined,
      moduleId: mostSignificant.moduleId || undefined,
      lessonId: mostSignificant.lessonId || undefined,
      metadata: { sourceEventId: mostSignificant.id, eventType: mostSignificant.eventType },
    },
  ];
};

module.exports = { detect };
