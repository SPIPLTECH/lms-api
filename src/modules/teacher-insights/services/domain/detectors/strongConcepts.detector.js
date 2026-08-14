const { COURSE_INSIGHT_TYPE, INSIGHT_PRIORITY, STRONG_CONCEPT_AVG_MASTERY, WEAK_CONCEPT_MIN_STUDENTS } = require("../../../constants");
const { average, round2 } = require("../../../utils/scoreMath.util");
const { groupByConcept } = require("./weakConcepts.detector");

/**
 * STRONG_CONCEPT: the mirror of weakConcepts — average mastery at/above
 * threshold across a minimum sample of students. Always LOW priority: a
 * strong concept isn't urgent, it's informational (worth confirming
 * nothing needs to change there).
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {import("../../../types/teacherInsight.types").CourseInsightCandidate[]}
 */
const detect = (context) => {
  const byConcept = groupByConcept(context.assessmentSummary?.masteryRows || []);
  const candidates = [];

  for (const [concept, rows] of byConcept) {
    if (rows.length < WEAK_CONCEPT_MIN_STUDENTS) continue;
    const avgMastery = round2(average(rows.map((r) => r.masteryScore)));
    if (avgMastery < STRONG_CONCEPT_AVG_MASTERY) continue;

    candidates.push({
      insightType: COURSE_INSIGHT_TYPE.STRONG_CONCEPT,
      dedupeKey: concept,
      priority: INSIGHT_PRIORITY.LOW,
      title: `"${concept}" is a strong concept for the class`,
      reason: `Average mastery is ${avgMastery} across ${rows.length} student(s) who've attempted it.`,
      confidence: 75,
      affectedStudentCount: rows.length,
      evidence: { concept, avgMastery, studentCount: rows.length },
    });
  }

  return candidates;
};

module.exports = { detect };
