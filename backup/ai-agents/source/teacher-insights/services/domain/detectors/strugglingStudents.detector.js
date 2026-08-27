const { ALERT_TYPE, INSIGHT_PRIORITY, STRUGGLING_OPEN_GAP_COUNT, STRUGGLING_AVG_SEVERITY } = require("../../../constants");
const { average, round2 } = require("../../../utils/scoreMath.util");

/**
 * STRUGGLING: distinct from AT_RISK — this reads Assessment's open
 * KnowledgeGap ledger directly, so it flags a student who's demonstrably
 * struggling with course material even if their overall engagement/risk
 * profile hasn't crossed the dropout threshold yet. Groups the flat
 * open-gaps list by student first, since Assessment's batch read returns
 * one row per (student, concept).
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {import("../../../types/teacherInsight.types").StudentAlertCandidate[]}
 */
const detect = (context) => {
  const gapsByStudent = new Map();
  for (const gap of context.assessmentSummary?.openGaps || []) {
    if (!gapsByStudent.has(gap.studentId)) gapsByStudent.set(gap.studentId, []);
    gapsByStudent.get(gap.studentId).push(gap);
  }

  const candidates = [];
  for (const [studentId, gaps] of gapsByStudent) {
    if (gaps.length < STRUGGLING_OPEN_GAP_COUNT) continue;
    const avgSeverity = round2(average(gaps.map((g) => g.severity)));
    if (avgSeverity < STRUGGLING_AVG_SEVERITY) continue;

    candidates.push({
      alertType: ALERT_TYPE.STRUGGLING,
      studentId,
      priority: gaps.length >= STRUGGLING_OPEN_GAP_COUNT * 2 ? INSIGHT_PRIORITY.HIGH : INSIGHT_PRIORITY.MEDIUM,
      reason: `${gaps.length} open knowledge gaps, averaging ${avgSeverity} severity.`,
      confidence: 75,
      evidence: { openGapCount: gaps.length, avgSeverity, concepts: gaps.map((g) => g.concept) },
    });
  }

  return candidates;
};

module.exports = { detect };
