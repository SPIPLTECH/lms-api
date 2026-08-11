const { ALERT_TYPE, INSIGHT_PRIORITY, INACTIVE_DAYS } = require("../../../constants");
const { daysBetween, round2 } = require("../../../utils/scoreMath.util");

/**
 * INACTIVE: a simple, direct read of Student State's lastActiveAt — a
 * class-level visibility signal for the instructor, distinct in purpose
 * from Motivation's own per-student INACTIVITY_ALERT (that one drives a
 * nudge to the student; this one tells the teacher who's gone quiet).
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {import("../../../types/teacherInsight.types").StudentAlertCandidate[]}
 */
const detect = (context) => {
  const candidates = [];

  for (const state of context.studentStates) {
    const lastActiveAt = state.engagement?.lastActiveAt;
    if (!lastActiveAt) continue;

    const idleDays = round2(daysBetween(context.now, new Date(lastActiveAt)));
    if (idleDays < INACTIVE_DAYS) continue;

    candidates.push({
      alertType: ALERT_TYPE.INACTIVE,
      studentId: state.studentId,
      priority: idleDays >= INACTIVE_DAYS * 2 ? INSIGHT_PRIORITY.HIGH : INSIGHT_PRIORITY.MEDIUM,
      reason: `No activity for ${Math.round(idleDays)} day(s).`,
      confidence: 90,
      evidence: { idleDays },
    });
  }

  return candidates;
};

module.exports = { detect };
