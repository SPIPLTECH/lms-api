const { CAREER_RECOMMENDATION_TYPE, SKILL_GAP_SEVERITY } = require("../../constants");
const { buildDedupeKey } = require("../../utils/dedupeKey.util");
const { clamp, round2 } = require("../../utils/scoreMath.util");

const SEVERITY_URGENCY = Object.freeze({ CRITICAL: 95, HIGH: 75, MEDIUM: 50, LOW: 25 });

/**
 * One COURSE candidate per open skill gap, escalating to a CERTIFICATION
 * candidate for HIGH/CRITICAL gaps (a bigger time investment, reserved for
 * the gaps that matter most), plus a PROJECT candidate for the top few —
 * hands-on evidence closes a gap faster than study alone.
 *
 * @param {import("../../types/career.types").StudentContext & {skillGaps: import("../../types/career.types").SkillGapCandidate[]}} context
 * @returns {import("../../types/career.types").CareerCandidate[]}
 */
const generate = (context) => {
  const gaps = context.skillGaps || [];
  const candidates = [];

  for (const gap of gaps) {
    const urgency = SEVERITY_URGENCY[gap.severity] ?? 40;
    const impact = clamp(round2(gap.gapSize * 1.2 + 20));

    candidates.push({
      type: CAREER_RECOMMENDATION_TYPE.COURSE,
      dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.COURSE, gap.skillName),
      reason: `Build "${gap.skillName}" — currently at ${gap.currentLevel}, your target role expects ${gap.requiredLevel}.`,
      urgency,
      impact,
      confidence: 75,
      estimatedTimeMinutes: 600,
      metadata: { skillName: gap.skillName, gapSize: gap.gapSize, severity: gap.severity },
    });

    if (gap.severity === SKILL_GAP_SEVERITY.HIGH || gap.severity === SKILL_GAP_SEVERITY.CRITICAL) {
      candidates.push({
        type: CAREER_RECOMMENDATION_TYPE.CERTIFICATION,
        dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.CERTIFICATION, gap.skillName),
        reason: `A recognized certification in "${gap.skillName}" would close a ${gap.severity.toLowerCase()}-severity gap toward your target role.`,
        urgency: clamp(urgency - 10),
        impact: clamp(impact + 10),
        confidence: 65,
        estimatedTimeMinutes: 2400,
        metadata: { skillName: gap.skillName, gapSize: gap.gapSize, severity: gap.severity },
      });
    }
  }

  for (const gap of gaps.slice(0, 3)) {
    candidates.push({
      type: CAREER_RECOMMENDATION_TYPE.PROJECT,
      dedupeKey: buildDedupeKey(CAREER_RECOMMENDATION_TYPE.PROJECT, gap.skillName),
      reason: `Build a small project demonstrating "${gap.skillName}" — hands-on evidence closes gaps faster than study alone.`,
      urgency: clamp((SEVERITY_URGENCY[gap.severity] ?? 40) - 5),
      impact: clamp(round2(gap.gapSize * 1.1 + 25)),
      confidence: 70,
      estimatedTimeMinutes: 1200,
      metadata: { skillName: gap.skillName, gapSize: gap.gapSize },
    });
  }

  return candidates;
};

module.exports = { generate };
