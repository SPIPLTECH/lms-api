const {
  MASTERY_STATUS,
  REASSESSMENT_INTERVAL_DAYS,
  RISK_ESCALATION_INTERVAL_FACTOR,
} = require("../../constants");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Next reassessment date for a concept, spaced-repetition-style: mastered
 * concepts get checked rarely, weak ones soon, unassessed ones not at all
 * (there's no evidence yet to decide a schedule from).
 *
 * @param {"UNASSESSED"|"WEAK"|"DEVELOPING"|"MASTERED"} status
 * @param {Date} now
 * @param {boolean} [riskEscalated] - true if Student State reports elevated dropout risk
 * @returns {Date|null}
 */
const scheduleNextReassessment = (status, now, riskEscalated = false) => {
  const baseDays = REASSESSMENT_INTERVAL_DAYS[status];
  if (baseDays === null || baseDays === undefined) return null;

  const days = status === MASTERY_STATUS.MASTERED ? baseDays : riskEscalated ? baseDays * RISK_ESCALATION_INTERVAL_FACTOR : baseDays;

  return new Date(now.getTime() + days * DAY_MS);
};

module.exports = { scheduleNextReassessment };
