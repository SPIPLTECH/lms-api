/** Minimal, realistic StudentContext builder for domain-generator unit tests. */
const makeContext = (overrides = {}) => ({
  studentId: "student_1",
  now: new Date("2026-01-10T00:00:00.000Z"),
  learningState: null,
  assessment: { mastery: { concepts: [], weakTopics: [], strongTopics: [] }, knowledgeGaps: { gaps: [] }, recommendations: { recommendations: [] }, reassessmentPlan: { plan: [] } },
  enrollments: [],
  recentEvents: [],
  currentLessonContents: [],
  pendingAssignments: [],
  pendingQuizzes: [],
  learningGoals: "",
  learningPath: null,
  ...overrides,
});

module.exports = { makeContext };
