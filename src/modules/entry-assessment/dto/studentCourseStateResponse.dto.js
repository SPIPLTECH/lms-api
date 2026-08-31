/** GET /student-state/course/:courseId — backs the "AI Personalization" dashboard widget. */
const toCourseStateResponse = (row) => ({
  studentId: row.studentId,
  courseId: row.courseId,
  knowledgeLevel: row.knowledgeLevel,
  entryAssessmentScore: row.entryAssessmentScore,
  confidenceScore: row.confidenceScore,
  conceptMastery: row.conceptMastery,
  strongConcepts: row.strongConcepts,
  weakConcepts: row.weakConcepts,
  originalTotalMinutes: row.originalTotalMinutes,
  personalizedTotalMinutes: row.personalizedTotalMinutes,
  timeSavedMinutes: row.timeSavedMinutes,
  initializedAt: row.initializedAt,
  updatedAt: row.updatedAt,
});

module.exports = { toCourseStateResponse };
