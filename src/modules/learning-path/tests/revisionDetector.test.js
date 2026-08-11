const test = require("node:test");
const assert = require("node:assert/strict");

const { detectRevisionTopics } = require("../services/domain/revisionDetector");

test("detectRevisionTopics returns one candidate per weak topic", () => {
  const result = detectRevisionTopics(["Arrays", "Recursion"], "course1");
  assert.equal(result.length, 2);
  assert.equal(result[0].topic, "Arrays");
  assert.equal(result[0].courseId, "course1");
  assert.match(result[0].reason, /Arrays/);
});

test("detectRevisionTopics returns an empty array for no weak topics", () => {
  assert.deepEqual(detectRevisionTopics([], "course1"), []);
  assert.deepEqual(detectRevisionTopics(null, "course1"), []);
});

test("detectRevisionTopics tolerates a null courseId", () => {
  const result = detectRevisionTopics(["X"], null);
  assert.equal(result[0].courseId, null);
});
