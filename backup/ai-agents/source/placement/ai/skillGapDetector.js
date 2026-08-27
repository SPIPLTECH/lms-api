const { normalizeSkillName } = require("../utils/dedupeKey.util");

/**
 * Diffs one opportunity's required skills against the student's current
 * skill vector — only skills with a real shortfall are returned, largest
 * gap first. Same discipline as Career Guidance's skillGapAnalyzer.js, just
 * against a job/internship's requirements instead of an IndustryRole's.
 *
 * @param {import("../types/placement.types").SkillVectorEntry[]} skillVector
 * @param {{requiredSkills: Record<string, number>}} opportunity
 * @returns {string[]} missing skill names, largest gap first
 */
const detectMissingSkills = (skillVector, opportunity) => {
  const proficiencyByName = new Map(skillVector.map((entry) => [normalizeSkillName(entry.skillName), entry.proficiency]));
  const requiredSkills = opportunity.requiredSkills || {};

  return Object.entries(requiredSkills)
    .map(([skillName, requiredLevel]) => ({ skillName, gapSize: Math.max(0, requiredLevel - (proficiencyByName.get(normalizeSkillName(skillName)) || 0)) }))
    .filter((entry) => entry.gapSize > 0)
    .sort((a, b) => b.gapSize - a.gapSize)
    .map((entry) => entry.skillName);
};

module.exports = { detectMissingSkills };
