/**
 * @typedef {"PLATFORM"|"COURSE"|"INSTRUCTOR"|"STUDENT"} ScopeType
 */

/**
 * @typedef {Object} MetricRecord
 * @property {string} metricKey
 * @property {number} value
 * @property {string} [unit]
 * @property {Object} [metadata]
 */

/**
 * @typedef {Object} TrendResult
 * @property {"UP"|"DOWN"|"STABLE"} direction
 * @property {number} changePercent
 * @property {number} currentValue
 * @property {number} previousValue
 * @property {number} windowDays
 */

/**
 * @typedef {Object} ForecastResult
 * @property {number} predictedValue
 * @property {number} confidenceScore
 * @property {string} method
 * @property {number} basedOnDataPoints
 */

module.exports = {};
