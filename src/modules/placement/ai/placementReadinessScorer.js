const {
  READINESS_WEIGHT_JOB_MATCH,
  READINESS_WEIGHT_INTERVIEW,
  READINESS_WEIGHT_RESUME,
  READINESS_WEIGHT_PORTFOLIO,
  READINESS_WEIGHT_CAREER,
} = require("../constants");
const { clamp } = require("../utils/scoreMath.util");

/**
 * Composite 0-100 blend of the best current job match, interview
 * readiness, the two resume/portfolio proxies, and Career Guidance's own
 * readiness score — never a single borrowed number pretending to be the
 * whole picture.
 *
 * @param {{topJobMatchPercent: number, interviewReadinessScore: number, resumeQualityScore: number, portfolioQualityScore: number, careerReadinessScore: number}} inputs
 * @returns {number} 0-100
 */
const calculatePlacementReadiness = ({
  topJobMatchPercent,
  interviewReadinessScore,
  resumeQualityScore,
  portfolioQualityScore,
  careerReadinessScore,
}) =>
  Math.round(
    clamp(
      topJobMatchPercent * READINESS_WEIGHT_JOB_MATCH +
        interviewReadinessScore * READINESS_WEIGHT_INTERVIEW +
        resumeQualityScore * READINESS_WEIGHT_RESUME +
        portfolioQualityScore * READINESS_WEIGHT_PORTFOLIO +
        careerReadinessScore * READINESS_WEIGHT_CAREER
    )
  );

module.exports = { calculatePlacementReadiness };
