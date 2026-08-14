const {
  READINESS_WEIGHT_SKILL_MATCH,
  READINESS_WEIGHT_ASSESSMENT_MASTERY,
  READINESS_WEIGHT_STUDENT_STATE,
  READINESS_WEIGHT_CREDENTIALS,
  READINESS_WEIGHT_ACTIVITY,
  READINESS_READY_THRESHOLD,
  READINESS_APPROACHING_THRESHOLD,
  CREDENTIAL_SCORE_CAP,
  MIN_SKILL_SIGNALS_FOR_HIGH_CONFIDENCE,
  MIN_SKILL_SIGNALS_FOR_MEDIUM_CONFIDENCE,
  CAREER_CONFIDENCE_LEVEL,
  INDUSTRY_READINESS_LEVEL,
} = require("../constants");
const { clamp } = require("../utils/scoreMath.util");

/**
 * Composite 0-100 blend — skill match to the target role, Assessment
 * mastery, Student State's performance/engagement/consistency composite,
 * real credential count, and recent activity — never a single borrowed
 * number pretending to be the whole picture.
 *
 * `confidenceLevel` drops with too little underlying skill data (few
 * SkillAssessment rows) rather than reporting a confident-looking score
 * from almost nothing — the same instinct Analytics' forecast engine uses
 * for its own minimum-data-points gate.
 *
 * @param {Object} inputs
 * @param {number} inputs.skillMatchPercent
 * @param {number} inputs.assessmentMasteryAvg - 0-100
 * @param {number} inputs.studentStateComposite - 0-100
 * @param {number} inputs.credentialCount - real Certificate rows
 * @param {number} inputs.activityScore - 0-100
 * @param {number} inputs.skillSignalCount - # of SkillAssessment rows
 * @returns {import("../types/career.types").ReadinessResult}
 */
const calculateReadiness = ({
  skillMatchPercent,
  assessmentMasteryAvg,
  studentStateComposite,
  credentialCount,
  activityScore,
  skillSignalCount,
}) => {
  const credentialScore = clamp((Math.min(credentialCount, CREDENTIAL_SCORE_CAP) / CREDENTIAL_SCORE_CAP) * 100);

  const readinessScore = Math.round(
    clamp(
      skillMatchPercent * READINESS_WEIGHT_SKILL_MATCH +
        assessmentMasteryAvg * READINESS_WEIGHT_ASSESSMENT_MASTERY +
        studentStateComposite * READINESS_WEIGHT_STUDENT_STATE +
        credentialScore * READINESS_WEIGHT_CREDENTIALS +
        activityScore * READINESS_WEIGHT_ACTIVITY
    )
  );

  const confidenceLevel =
    skillSignalCount >= MIN_SKILL_SIGNALS_FOR_HIGH_CONFIDENCE
      ? CAREER_CONFIDENCE_LEVEL.HIGH
      : skillSignalCount >= MIN_SKILL_SIGNALS_FOR_MEDIUM_CONFIDENCE
        ? CAREER_CONFIDENCE_LEVEL.MEDIUM
        : CAREER_CONFIDENCE_LEVEL.LOW;

  const industryReadiness =
    readinessScore >= READINESS_READY_THRESHOLD
      ? INDUSTRY_READINESS_LEVEL.READY
      : readinessScore >= READINESS_APPROACHING_THRESHOLD
        ? INDUSTRY_READINESS_LEVEL.APPROACHING
        : INDUSTRY_READINESS_LEVEL.NOT_READY;

  return { readinessScore, confidenceLevel, industryReadiness };
};

module.exports = { calculateReadiness };
