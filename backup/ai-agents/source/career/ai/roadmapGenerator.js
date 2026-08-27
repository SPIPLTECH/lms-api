const { ROADMAP_HORIZON, ROADMAP_HORIZON_DAYS, ESTIMATED_EFFORT_DAYS } = require("../constants");

const HORIZON_ORDER = [ROADMAP_HORIZON.DAYS_30, ROADMAP_HORIZON.DAYS_90, ROADMAP_HORIZON.MONTHS_6, ROADMAP_HORIZON.YEAR_1];
const DEFAULT_EFFORT_DAYS = 14;

/**
 * Deterministically schedules already-ranked candidates onto one cumulative
 * day timeline (highest-priority first, using each type's estimated effort
 * in days), then slices that timeline into the four horizons. Horizons are
 * cumulative/inclusive — the 90-day plan is everything from day 0-90, the
 * same way a real roadmap reads, not just "what's new since day 30".
 *
 * @param {import("../types/career.types").CareerCandidate[]} rankedCandidates - already scored/sorted, highest first.
 * @returns {Record<string, Array>} milestones per horizon key
 */
const generateRoadmaps = (rankedCandidates) => {
  let cursorDay = 0;
  const scheduled = rankedCandidates.map((candidate, index) => {
    const estimatedDays = ESTIMATED_EFFORT_DAYS[candidate.type] || DEFAULT_EFFORT_DAYS;
    const startDay = cursorDay;
    cursorDay += estimatedDays;
    return {
      order: index + 1,
      title: candidate.reason,
      type: candidate.type,
      dedupeKey: candidate.dedupeKey,
      estimatedDays,
      startDay,
      endDay: cursorDay,
      description: candidate.reason,
    };
  });

  const milestonesByHorizon = {};
  for (const horizon of HORIZON_ORDER) {
    const horizonDays = ROADMAP_HORIZON_DAYS[horizon];
    milestonesByHorizon[horizon] = scheduled.filter((milestone) => milestone.startDay < horizonDays);
  }

  return milestonesByHorizon;
};

module.exports = { generateRoadmaps };
