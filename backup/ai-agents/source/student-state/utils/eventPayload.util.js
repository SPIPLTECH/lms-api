/**
 * Defensive accessors for LearningEvent.payload (free-form JSON supplied by
 * whatever module emitted the event). Every reducer reads payload through
 * these helpers instead of touching `event.payload.x` directly, so a
 * missing/malformed field degrades to "skip this contribution" rather than
 * throwing and breaking the whole update pipeline.
 */

const toFiniteNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const getNumber = (payload, key) => {
  if (!payload || typeof payload !== "object") return null;
  return toFiniteNumber(payload[key]);
};

const getBoolean = (payload, key) => {
  if (!payload || typeof payload !== "object") return null;
  const value = payload[key];
  return typeof value === "boolean" ? value : null;
};

const getString = (payload, key) => {
  if (!payload || typeof payload !== "object") return null;
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/**
 * @param {object} payload
 * @param {string} key
 * @returns {Record<string, number>|null} plain object of numeric scores,
 *   e.g. payload.conceptScores = { algebra: 0.8, geometry: 0.4 }
 */
const getScoreMap = (payload, key) => {
  if (!payload || typeof payload !== "object") return null;
  const value = payload[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const result = {};
  for (const [topic, rawScore] of Object.entries(value)) {
    const score = toFiniteNumber(rawScore);
    if (score !== null && topic) result[topic] = score;
  }
  return Object.keys(result).length > 0 ? result : null;
};

module.exports = {
  getNumber,
  getBoolean,
  getString,
  getScoreMap,
};
