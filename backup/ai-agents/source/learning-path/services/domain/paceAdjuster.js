const {
  DIFFICULTY_ADJUSTMENT,
  EASE_UP_PASS_RATE_THRESHOLD,
  ACCELERATE_PASS_RATE_THRESHOLD,
  EASE_UP_MINUTES_MULTIPLIER,
  ACCELERATE_MINUTES_MULTIPLIER,
  DEFAULT_DAILY_STUDY_MINUTES,
  MIN_DAILY_STUDY_MINUTES,
  LEARNING_SPEED,
} = require("../../constants");

/**
 * Blends Student State's own preferredLearningSpeed with recent quiz pass
 * rate and improvement trend into a pacing decision — this only changes
 * how much/how fast this agent *recommends* the student move, it never
 * touches course content or its actual difficulty.
 *
 * @param {{preferredLearningSpeed: string|null, passRate: number, improvementTrend: string, baseDailyMinutes: number}} inputs
 * @returns {import("../../types/learningPath.types").PaceResult}
 */
const determinePace = ({ preferredLearningSpeed, passRate, improvementTrend, baseDailyMinutes }) => {
  let difficultyAdjustment = DIFFICULTY_ADJUSTMENT.STANDARD;

  if (passRate < EASE_UP_PASS_RATE_THRESHOLD || preferredLearningSpeed === LEARNING_SPEED.SLOW) {
    difficultyAdjustment = DIFFICULTY_ADJUSTMENT.EASE_UP;
  } else if (
    passRate >= ACCELERATE_PASS_RATE_THRESHOLD &&
    preferredLearningSpeed === LEARNING_SPEED.FAST &&
    improvementTrend === "IMPROVING"
  ) {
    difficultyAdjustment = DIFFICULTY_ADJUSTMENT.ACCELERATE;
  }

  const base = baseDailyMinutes || DEFAULT_DAILY_STUDY_MINUTES;
  const multiplier =
    difficultyAdjustment === DIFFICULTY_ADJUSTMENT.EASE_UP
      ? EASE_UP_MINUTES_MULTIPLIER
      : difficultyAdjustment === DIFFICULTY_ADJUSTMENT.ACCELERATE
        ? ACCELERATE_MINUTES_MULTIPLIER
        : 1;

  const suggestedStudyMinutesPerDay = Math.max(MIN_DAILY_STUDY_MINUTES, Math.round(base * multiplier));

  return { difficultyAdjustment, suggestedStudyMinutesPerDay };
};

module.exports = { determinePace };
