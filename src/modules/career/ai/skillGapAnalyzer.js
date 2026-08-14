const { normalizeSkillName } = require("../utils/dedupeKey.util");
const { SKILL_GAP_SEVERITY_THRESHOLDS, SKILL_GAP_SEVERITY } = require("../constants");

const classifySeverity = (gapSize) => {
  if (gapSize >= SKILL_GAP_SEVERITY_THRESHOLDS.CRITICAL) return SKILL_GAP_SEVERITY.CRITICAL;
  if (gapSize >= SKILL_GAP_SEVERITY_THRESHOLDS.HIGH) return SKILL_GAP_SEVERITY.HIGH;
  if (gapSize >= SKILL_GAP_SEVERITY_THRESHOLDS.MEDIUM) return SKILL_GAP_SEVERITY.MEDIUM;
  return SKILL_GAP_SEVERITY.LOW;
};

/**
 * Diffs a target role's required skills against the student's current
 * skill vector. Only skills with a real shortfall (currentLevel <
 * requiredLevel) are returned — a skill already at/above the required
 * level isn't a gap, even if the student hasn't "mastered" it outright.
 *
 * @param {import("../types/career.types").SkillVectorEntry[]} skillVector
 * @param {{requiredSkills: Record<string, number>}} role
 * @returns {import("../types/career.types").SkillGapCandidate[]} sorted largest gap first
 */
const analyzeGaps = (skillVector, role) => {
  const proficiencyByName = new Map(skillVector.map((entry) => [normalizeSkillName(entry.skillName), entry.proficiency]));
  const requiredSkills = role.requiredSkills || {};

  return Object.entries(requiredSkills)
    .map(([skillName, requiredLevel]) => {
      const currentLevel = proficiencyByName.get(normalizeSkillName(skillName)) || 0;
      const gapSize = Math.max(0, requiredLevel - currentLevel);
      return { skillName, requiredLevel, currentLevel, gapSize, severity: classifySeverity(gapSize) };
    })
    .filter((gap) => gap.gapSize > 0)
    .sort((a, b) => b.gapSize - a.gapSize);
};

module.exports = { analyzeGaps, classifySeverity };
