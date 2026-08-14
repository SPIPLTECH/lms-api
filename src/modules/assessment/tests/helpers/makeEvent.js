const { EVENT_TYPES } = require("../../constants");

let counter = 0;

/** Builds a LearningEvent-shaped object for domain-logic tests. */
const makeEvent = (overrides = {}) => {
  counter += 1;
  return {
    id: `evt_${counter}`,
    studentId: "student_1",
    courseId: null,
    moduleId: null,
    lessonId: null,
    contentId: null,
    quizId: null,
    assignmentId: null,
    sessionId: "session_1",
    eventType: EVENT_TYPES.QUIZ_COMPLETED,
    eventCategory: "QUIZ",
    payload: null,
    metadata: null,
    createdAt: new Date("2026-01-01T10:00:00.000Z"),
    ...overrides,
  };
};

module.exports = { makeEvent };
