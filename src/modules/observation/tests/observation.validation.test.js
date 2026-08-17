const test = require("node:test");
const assert = require("node:assert/strict");

const { createEventSchema, listQuerySchema } = require("../validation/observation.validation");
const { EVENT_TYPES } = require("../constants");

test("createEventSchema accepts a minimal valid event", () => {
  const { error, value } = createEventSchema.validate({
    eventType: EVENT_TYPES.VIDEO_PROGRESS,
    courseId: "course_1",
    payload: { positionSeconds: 42, durationSeconds: 600 },
  });

  assert.equal(error, undefined);
  assert.equal(value.eventType, EVENT_TYPES.VIDEO_PROGRESS);
});

test("createEventSchema rejects an unknown eventType", () => {
  const { error } = createEventSchema.validate({ eventType: "NOT_REAL" });
  assert.ok(error);
});

test("createEventSchema rejects missing eventType", () => {
  const { error } = createEventSchema.validate({ courseId: "course_1" });
  assert.ok(error);
});

test("createEventSchema strips an unexpected client-supplied eventCategory (as the validate middleware does)", () => {
  const { error, value } = createEventSchema.validate(
    {
      eventType: EVENT_TYPES.QUIZ_SUBMITTED,
      eventCategory: "SOMETHING_MADE_UP",
    },
    { stripUnknown: true }
  );

  assert.equal(error, undefined);
  assert.equal(value.eventCategory, undefined);
});

test("createEventSchema rejects an oversized payload", () => {
  const bigPayload = { blob: "x".repeat(20 * 1024) };
  const { error } = createEventSchema.validate({
    eventType: EVENT_TYPES.AI_CHAT_MESSAGE_SENT,
    payload: bigPayload,
  });

  assert.ok(error);
});

test("listQuerySchema defaults page/limit and rejects endDate before startDate", () => {
  const { value } = listQuerySchema.validate({});
  assert.equal(value.page, 1);
  assert.equal(value.limit, 20);

  const { error } = listQuerySchema.validate({
    startDate: "2026-02-01",
    endDate: "2026-01-01",
  });
  assert.ok(error);
});
