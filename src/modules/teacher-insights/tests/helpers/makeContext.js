/** Minimal, realistic CourseContext builder for domain-detector unit tests. */
const makeContext = (overrides = {}) => ({
  courseId: "course_1",
  course: { id: "course_1", title: "Intro to Testing", category: "Programming", creatorId: "teacher_1" },
  studentIds: [],
  enrolledCount: 0,
  studentStates: [],
  assessmentSummary: { masteryRows: [], openGaps: [] },
  activeRecommendations: [],
  motivationSummary: { actions: [], streaks: [] },
  learningPathStates: [],
  lessons: [],
  quizzes: [],
  assignments: [],
  now: new Date("2026-01-10T12:00:00.000Z"),
  ...overrides,
});

module.exports = { makeContext };
