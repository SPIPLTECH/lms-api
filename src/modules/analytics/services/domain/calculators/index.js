const { calculateStudentMetrics } = require("./student.calculator");
const { calculateInstructorMetrics } = require("./instructor.calculator");
const { calculateCourseMetrics } = require("./course.calculator");
const { calculatePlatformMetrics } = require("./platform.calculator");

const { SCOPE_TYPE } = require("../../../constants");

const CALCULATOR_BY_SCOPE = {
  [SCOPE_TYPE.STUDENT]: (scopeId) => calculateStudentMetrics(scopeId),
  [SCOPE_TYPE.INSTRUCTOR]: (scopeId) => calculateInstructorMetrics(scopeId),
  [SCOPE_TYPE.COURSE]: (scopeId) => calculateCourseMetrics(scopeId),
  [SCOPE_TYPE.PLATFORM]: () => calculatePlatformMetrics(),
};

/**
 * @param {import("../../../types/analytics.types").ScopeType} scopeType
 * @param {string} scopeId
 * @returns {Promise<import("../../../types/analytics.types").MetricRecord[]>}
 */
const calculateMetricsForScope = (scopeType, scopeId) => {
  const calculator = CALCULATOR_BY_SCOPE[scopeType];
  if (!calculator) throw new Error(`Unknown analytics scope type: ${scopeType}`);
  return calculator(scopeId);
};

module.exports = { calculateMetricsForScope };
