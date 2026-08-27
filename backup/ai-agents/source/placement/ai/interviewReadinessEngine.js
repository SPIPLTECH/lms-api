const {
  INTERVIEW_WEIGHT_CAREER_READINESS,
  INTERVIEW_WEIGHT_ASSESSMENT_MASTERY,
  INTERVIEW_WEIGHT_HISTORY,
  INTERVIEW_PASS_RATE_DEFAULT,
  MIN_INTERVIEWS_FOR_HISTORY_WEIGHT,
} = require("../constants");
const { clamp, percent } = require("../utils/scoreMath.util");

/**
 * Blends Career Guidance's own readiness score, Assessment's mastery
 * average, and this agent's own historical Interview outcomes. Below
 * MIN_INTERVIEWS_FOR_HISTORY_WEIGHT decisive (PASSED/FAILED) interviews,
 * the neutral default pass rate doesn't get to influence the score at all —
 * its weight is redistributed to the two signals actually backed by real
 * data, rather than letting a fabricated-looking "50%" masquerade as one.
 *
 * @param {{careerReadinessScore: number, assessmentMasteryAvg: number, interviewHistory: {outcome: string}[]}} inputs
 * @returns {{interviewReadinessScore: number, historyPassRate: number, hasInterviewHistory: boolean}}
 */
const calculateInterviewReadiness = ({ careerReadinessScore, assessmentMasteryAvg, interviewHistory }) => {
  const decisiveInterviews = (interviewHistory || []).filter((i) => i.outcome === "PASSED" || i.outcome === "FAILED");
  const hasInterviewHistory = decisiveInterviews.length >= MIN_INTERVIEWS_FOR_HISTORY_WEIGHT;

  const historyPassRate = hasInterviewHistory
    ? percent(decisiveInterviews.filter((i) => i.outcome === "PASSED").length, decisiveInterviews.length)
    : INTERVIEW_PASS_RATE_DEFAULT;

  const historyWeight = hasInterviewHistory ? INTERVIEW_WEIGHT_HISTORY : 0;
  const redistribution = hasInterviewHistory ? 0 : INTERVIEW_WEIGHT_HISTORY / 2;
  const careerWeight = INTERVIEW_WEIGHT_CAREER_READINESS + redistribution;
  const masteryWeight = INTERVIEW_WEIGHT_ASSESSMENT_MASTERY + redistribution;

  const interviewReadinessScore = Math.round(
    clamp(careerReadinessScore * careerWeight + assessmentMasteryAvg * masteryWeight + historyPassRate * historyWeight)
  );

  return { interviewReadinessScore, historyPassRate, hasInterviewHistory };
};

module.exports = { calculateInterviewReadiness };
