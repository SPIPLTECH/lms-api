/** Joins identifying parts into one stable dedupeKey — same convention as every other agent's dedupeKey.util.js. */
const buildDedupeKey = (...parts) => parts.map((part) => String(part ?? "")).join(":");

module.exports = { buildDedupeKey };
