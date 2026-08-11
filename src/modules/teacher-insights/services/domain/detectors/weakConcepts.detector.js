const { COURSE_INSIGHT_TYPE, INSIGHT_PRIORITY, WEAK_CONCEPT_AVG_MASTERY, WEAK_CONCEPT_MIN_STUDENTS } = require("../../../constants");
const { average, round2 } = require("../../../utils/scoreMath.util");

const groupByConcept = (masteryRows) => {
  const byConcept = new Map();
  for (const row of masteryRows) {
    if (!byConcept.has(row.concept)) byConcept.set(row.concept, []);
    byConcept.get(row.concept).push(row);
  }
  return byConcept;
};

/**
 * WEAK_CONCEPT: aggregates Assessment's ConceptMastery across every
 * enrolled student — a concept is weak for the class when the average
 * mastery score across everyone who's attempted it falls at/below
 * threshold, with a minimum sample size so one struggling student doesn't
 * flag a concept as class-wide weak.
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
    if (avgMastery > WEAK_CONCEPT_AVG_MASTERY) continue;

    candidates.push({
      insightType: COURSE_INSIGHT_TYPE.WEAK_CONCEPT,
      dedupeKey: concept,
      priority: avgMastery <= WEAK_CONCEPT_AVG_MASTERY / 2 ? INSIGHT_PRIORITY.HIGH : INSIGHT_PRIORITY.MEDIUM,
      title: `"${concept}" is a weak concept for the class`,
      reason: `Average mastery is ${avgMastery} across ${rows.length} student(s) who've attempted it.`,
      confidence: 75,
      affectedStudentCount: rows.length,
      evidence: { concept, avgMastery, studentCount: rows.length },
    });
  }

  return candidates;
};

module.exports = { detect, groupByConcept };
