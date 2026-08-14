const { normalizeSkillName } = require("../utils/dedupeKey.util");
const { round2 } = require("../utils/scoreMath.util");

const buildProficiencyLookup = (skillVector) => {
  const lookup = new Map();
  for (const entry of skillVector) lookup.set(normalizeSkillName(entry.skillName), entry.proficiency);
  return lookup;
};

/**
 * Weighted match: each required skill contributes up to its own weight —
 * a student proficient beyond what's required doesn't over-credit the
 * match, and a skill with zero signal contributes zero. Skill names are
 * matched by normalized string equality — the same approach and the same
 * limitation Career Guidance's skillMatchEngine.js already documents:
 * there's no canonical skill-ID taxonomy in this LMS to join by ID instead.
 *
 * @param {import("../types/placement.types").SkillVectorEntry[]} skillVector
 * @param {{requiredSkills: Record<string, number>}} opportunity
 * @returns {number} 0-100
 */
const matchScoreForOpportunity = (skillVector, opportunity) => {
  const proficiencyByName = buildProficiencyLookup(skillVector);
  const requiredSkills = opportunity.requiredSkills || {};
  const skillNames = Object.keys(requiredSkills);
  if (skillNames.length === 0) return 0;

  let totalWeight = 0;
  let achievedWeight = 0;

  for (const skillName of skillNames) {
    const weight = requiredSkills[skillName];
    const proficiency = proficiencyByName.get(normalizeSkillName(skillName)) || 0;
    totalWeight += weight;
    achievedWeight += Math.min(proficiency, weight);
  }

  return totalWeight === 0 ? 0 : round2((achievedWeight / totalWeight) * 100);
};

/**
 * @param {import("../types/placement.types").SkillVectorEntry[]} skillVector
 * @param {Array} opportunities - JobOpportunity or InternshipOpportunity rows.
 * @returns {{opportunity: Object, matchPercent: number}[]} unsorted — ranking is opportunityRanker.js's job.
 */
const matchOpportunities = (skillVector, opportunities) =>
  opportunities.map((opportunity) => ({ opportunity, matchPercent: matchScoreForOpportunity(skillVector, opportunity) }));

module.exports = { matchScoreForOpportunity, matchOpportunities };
