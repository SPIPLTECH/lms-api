/** Defensive accessors for LearningEvent.payload — same pattern used across every agent in this codebase. */

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

/** @returns {Record<string, number>|null} e.g. payload.conceptScores = { algebra: 0.8 } */
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

module.exports = { getNumber, getBoolean, getString, getScoreMap };
