const { readModuleMinutes } = require("./courseStructureReader");
const {
  LEARNING_MODE,
  DEFAULT_LESSON_MINUTES,
  SMART_REVISION_THRESHOLD,
  DEEP_LEARNING_THRESHOLD,
  SMART_REVISION_MINUTES_MULTIPLIER,
  SMART_REVISION_MIN_MINUTES,
  SMART_REVISION_MAX_MINUTES,
  DEEP_LEARNING_MINUTES_MULTIPLIER,
} = require("../../constants");

/**
 * Per-concept mastery (0-100) -> learning mode + recommended minutes.
 * Explicit thresholds, not a model — every concept is always studied
 * (never skipped), only the depth/duration is compressed or expanded.
 *
 * @param {number} masteryScore
 * @param {number} originalMinutes
 */
const personalizeConcept = (masteryScore, originalMinutes) => {
  if (masteryScore >= SMART_REVISION_THRESHOLD) {
    const compressed = Math.round(originalMinutes * SMART_REVISION_MINUTES_MULTIPLIER);
    return { mode: LEARNING_MODE.SMART_REVISION, recommendedMinutes: Math.min(SMART_REVISION_MAX_MINUTES, Math.max(SMART_REVISION_MIN_MINUTES, compressed)) };
  }

  if (masteryScore < DEEP_LEARNING_THRESHOLD) {
    return { mode: LEARNING_MODE.DEEP_LEARNING, recommendedMinutes: Math.round(originalMinutes * DEEP_LEARNING_MINUTES_MULTIPLIER) };
  }

  return { mode: LEARNING_MODE.STANDARD_LEARNING, recommendedMinutes: originalMinutes };
};

/**
 * Builds the full per-course personalization payload from the entry
 * assessment's evaluated concept scores: real per-module durations, plus
 * the aggregate totals the dashboard needs ("Time Saved Through AI
 * Personalization").
 *
 * @param {string} courseId
 * @param {{concept: string, moduleId: string|null, masteryScore: number}[]} conceptScores
 */
const buildCourseStatePersonalization = async (courseId, conceptScores) => {
  const moduleMinutesById = await readModuleMinutes(courseId);

  let originalTotalMinutes = 0;
  let personalizedTotalMinutes = 0;

  const conceptMastery = conceptScores.map((score) => {
    const originalMinutes = (score.moduleId && moduleMinutesById.get(score.moduleId)) || DEFAULT_LESSON_MINUTES;
    const { mode, recommendedMinutes } = personalizeConcept(score.masteryScore, originalMinutes);

    originalTotalMinutes += originalMinutes;
    personalizedTotalMinutes += recommendedMinutes;

    return {
      concept: score.concept,
      moduleId: score.moduleId,
      masteryScore: score.masteryScore,
      recommendedMode: mode,
      originalMinutes,
      recommendedMinutes,
    };
  });

  return {
    conceptMastery,
    originalTotalMinutes,
    personalizedTotalMinutes,
    timeSavedMinutes: Math.max(0, originalTotalMinutes - personalizedTotalMinutes),
  };
};

module.exports = { personalizeConcept, buildCourseStatePersonalization };
