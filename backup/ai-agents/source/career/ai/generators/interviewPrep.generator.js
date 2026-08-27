const { CAREER_RECOMMENDATION_TYPE, INDUSTRY_READINESS_LEVEL } = require("../../constants");
const { buildDedupeKey } = require("../../utils/dedupeKey.util");
const { clamp } = require("../../utils/scoreMath.util");

/**
 * Technical interview topics come straight from the top open skill gaps —
 * what you're weakest in is exactly what an interviewer will probe.
 * Aptitude prep is always relevant; mock interviews and internship prep
 * only surface once the student is APPROACHING or READY, since they're
 * premature asks for a student still far from baseline readiness.
 *
 * @param {import("../../types/career.types").StudentContext & {skillGaps: Array, previousIndustryReadiness: string}} context
 * @returns {import("../../types/career.types").CareerCandidate[]}
 */
const generate = (context) => {
  const gaps = context.skillGaps || [];
  const industryReadiness = context.previousIndustryReadiness || INDUSTRY_READINESS_LEVEL.NOT_READY;
  const candidates = [];

  for (const gap of gaps.slice(0, 5)) {
    candidates.push({
      type: CAREER_RECOMMENDATION_TYPE.TECHNICAL_INTERVIEW_TOPIC,
      dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.TECHNICAL_INTERVIEW_TOPIC, gap.skillName),
      reason: `Expect "${gap.skillName}" questions in technical interviews for your target role — practice this before applying.`,
      urgency: 50,
      impact: 45,
      confidence: 65,
      estimatedTimeMinutes: 120,
      metadata: { skillName: gap.skillName },
    });
  }

  candidates.push({
    type: CAREER_RECOMMENDATION_TYPE.APTITUDE_PREP,
    dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.APTITUDE_PREP, "general"),
    reason: "Most entry-level hiring pipelines include an aptitude/reasoning screen before the technical rounds — keep this fresh.",
    urgency: 35,
    impact: 35,
    confidence: 55,
    estimatedTimeMinutes: 300,
    metadata: {},
  });

  if (industryReadiness !== INDUSTRY_READINESS_LEVEL.NOT_READY) {
    candidates.push({
      type: CAREER_RECOMMENDATION_TYPE.MOCK_INTERVIEW,
      dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.MOCK_INTERVIEW, "general"),
      reason: "You're close enough to target-role readiness that a mock interview now will surface real gaps before a real one does.",
      urgency: 55,
      impact: 60,
      confidence: 65,
      estimatedTimeMinutes: 60,
      metadata: {},
    });

    candidates.push({
      type: CAREER_RECOMMENDATION_TYPE.INTERNSHIP_PREP,
      dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.INTERNSHIP_PREP, "general"),
      reason: "Start preparing internship-application materials now — application cycles often close before readiness peaks.",
      urgency: 45,
      impact: 55,
      confidence: 60,
      estimatedTimeMinutes: 180,
      metadata: {},
    });
  }

  return candidates.map((candidate) => ({ ...candidate, urgency: clamp(candidate.urgency), impact: clamp(candidate.impact) }));
};

module.exports = { generate };
