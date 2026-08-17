const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeEvent } = require("../utils/normalizeEvent.util");
const { EVENT_TYPES, EVENT_CATEGORIES } = require("../constants");

test("normalizeEvent derives eventCategory from eventType, never from input", () => {
  const result = normalizeEvent({
    input: { eventType: EVENT_TYPES.LESSON_COMPLETED, eventCategory: "IGNORED" },
    studentId: "student_1",
    requestContext: { ipAddress: "127.0.0.1", userAgent: "test-agent" },
  });

  assert.equal(result.eventCategory, EVENT_CATEGORIES.LESSON);
  assert.equal(result.studentId, "student_1");
  assert.equal(result.ipAddress, "127.0.0.1");
});

test("normalizeEvent generates a sessionId when none is supplied", () => {
  const result = normalizeEvent({
    input: { eventType: EVENT_TYPES.PAGE_VIEWED },
    studentId: "student_1",
    requestContext: {},
  });

  assert.ok(result.sessionId.startsWith("sess_"));
});

test("normalizeEvent preserves a client-supplied sessionId", () => {
  const result = normalizeEvent({
    input: { eventType: EVENT_TYPES.VIDEO_PROGRESS, sessionId: "custom_session_123" },
    studentId: "student_1",
    requestContext: {},
  });

  assert.equal(result.sessionId, "custom_session_123");
});

test("normalizeEvent defaults optional relation ids to null, not undefined", () => {
  const result = normalizeEvent({
    input: { eventType: EVENT_TYPES.USER_LOGIN },
    studentId: "student_1",
    requestContext: {},
  });

  assert.equal(result.courseId, null);
  assert.equal(result.moduleId, null);
  assert.equal(result.quizId, null);
});
