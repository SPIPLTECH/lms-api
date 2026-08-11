/** Minimal, realistic StudentContext builder for domain-detector unit tests. */
const makeContext = (overrides = {}) => ({
  studentId: "student_1",
  now: new Date("2026-01-10T12:00:00.000Z"),
  learningState: null,
  assessment: { reassessmentPlan: { plan: [] } },
  recommendation: { recommendations: [] },
  recentEvents: [],
  recentAchievements: [],
  pendingAssignments: [],
  pendingQuizzes: [],
  streak: null,
  learningPath: null,
  ...overrides,
});

module.exports = { makeContext };
