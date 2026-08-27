const atRiskStudents = require("./atRiskStudents.detector");
const strugglingStudents = require("./strugglingStudents.detector");
const inactiveStudents = require("./inactiveStudents.detector");
const topPerformers = require("./topPerformers.detector");

const weakConcepts = require("./weakConcepts.detector");
const strongConcepts = require("./strongConcepts.detector");
const lessonCompletionTrend = require("./lessonCompletionTrend.detector");
const quizPerformanceTrend = require("./quizPerformanceTrend.detector");
const assignmentPerformanceTrend = require("./assignmentPerformanceTrend.detector");

const instructorActions = require("./instructorActions.detector");
const teachingSuggestions = require("./teachingSuggestions.detector");

const { calculateCourseHealth } = require("../courseHealthCalculator");
const { ALERT_TYPE } = require("../../../constants");

/**
 * Runs the full insight engine against one CourseContext: student-level
 * alerts and course-level content insights run first (each independent,
 * like Motivation's detectors), then CourseHealth is computed from their
 * combined result, then the two TeachingRecommendation detectors run last
 * since they cross-reference everything already found — the same
 * "composites run after primaries" ordering Recommendation's studyTasks
 * generator used.
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {{studentAlerts: Object[], courseInsights: Object[], courseHealth: Object, teachingRecommendations: Object[]}}
 */
const generateAllInsights = (context) => {
  const studentAlerts = [
    ...atRiskStudents.detect(context),
    ...strugglingStudents.detect(context),
    ...inactiveStudents.detect(context),
    ...topPerformers.detect(context),
  ];

  const courseInsights = [
    ...weakConcepts.detect(context),
    ...strongConcepts.detect(context),
    ...lessonCompletionTrend.detect(context),
    ...quizPerformanceTrend.detect(context),
    ...assignmentPerformanceTrend.detect(context),
  ];

  const atRiskCount = studentAlerts.filter((a) => a.alertType === ALERT_TYPE.AT_RISK).length;
  const courseHealth = calculateCourseHealth(context, atRiskCount);

  const teachingRecommendations = [
    ...instructorActions.detect(context, { studentAlerts, courseInsights }),
    ...teachingSuggestions.detect(context, { studentAlerts, courseInsights }),
  ];

  return { studentAlerts, courseInsights, courseHealth, teachingRecommendations };
};

module.exports = { generateAllInsights };
