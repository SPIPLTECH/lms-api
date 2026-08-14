const test = require("node:test");
const assert = require("node:assert/strict");

const { detect } = require("../../services/domain/detectors/congratulations.detector");
const { makeContext } = require("../helpers/makeContext");

test("congratulations.detect stays silent with no completion events", () => {
  assert.deepEqual(detect(makeContext({ recentEvents: [{ id: "e1", eventType: "VIDEO_PLAYED" }] })), []);
});

test("congratulations.detect picks the single most significant completion", () => {
  const context = makeContext({
    recentEvents: [
      { id: "e1", eventType: "LESSON_COMPLETED", courseId: "c1" },
      { id: "e2", eventType: "COURSE_COMPLETED", courseId: "c1" },
      { id: "e3", eventType: "QUIZ_COMPLETED", courseId: "c1" },
    ],
  });
  const candidates = detect(context);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].dedupeKey, "e2");
});
