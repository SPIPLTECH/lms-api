const test = require("node:test");
const assert = require("node:assert/strict");

const { buildRecommendations } = require("../services/domain/recommendationBuilder");

const sequence = [
  { lessonId: "l1", moduleId: "m1", title: "L1", order: 1, completed: true, estimatedMinutes: 10 },
  { lessonId: "l2", moduleId: "m1", title: "L2", order: 2, completed: false, estimatedMinutes: 10 },
  { lessonId: "l3", moduleId: "m2", title: "L3", order: 3, completed: false, estimatedMinutes: 10 },
];

test("buildRecommendations always includes NEXT_LESSON when a next item exists", () => {
  const result = buildRecommendations({
    nextItem: sequence[1],
    sequence,
    courseId: "c1",
    revisionTopics: [],
    difficultyAdjustment: "STANDARD",
    currentLessonId: null,
  });
  assert.ok(result.some((r) => r.type === "NEXT_LESSON" && r.lessonId === "l2"));
});

test("buildRecommendations omits NEXT_MODULE when the module has already been started", () => {
  // l2 is next, its module m1 already has a completed lesson (l1) -> not a "new" module.
  const result = buildRecommendations({
    nextItem: sequence[1],
    sequence,
    courseId: "c1",
    revisionTopics: [],
    difficultyAdjustment: "STANDARD",
    currentLessonId: null,
  });
  assert.ok(!result.some((r) => r.type === "NEXT_MODULE"));
});

test("buildRecommendations includes NEXT_MODULE when the next lesson starts a fresh module", () => {
  const result = buildRecommendations({
    nextItem: sequence[2], // l3, module m2, no completed lessons in m2
    sequence,
    courseId: "c1",
    revisionTopics: [],
    difficultyAdjustment: "STANDARD",
    currentLessonId: null,
  });
  assert.ok(result.some((r) => r.type === "NEXT_MODULE" && r.moduleId === "m2"));
});

test("buildRecommendations converts each revision topic into a REVISION candidate", () => {
  const result = buildRecommendations({
    nextItem: null,
    sequence,
    courseId: "c1",
    revisionTopics: [{ topic: "X", reason: "weak", courseId: "c1" }],
    difficultyAdjustment: "STANDARD",
    currentLessonId: null,
  });
  assert.ok(result.some((r) => r.type === "REVISION" && r.metadata.topic === "X"));
});

test("buildRecommendations detects PREREQUISITE when the student is viewing a lesson ahead of the recommended next one", () => {
  const result = buildRecommendations({
    nextItem: sequence[1], // l2 is next
    sequence,
    courseId: "c1",
    revisionTopics: [],
    difficultyAdjustment: "STANDARD",
    currentLessonId: "l3", // student is actively viewing l3, which is ahead of l2
  });
  assert.ok(result.some((r) => r.type === "PREREQUISITE"));
});

test("buildRecommendations omits PREREQUISITE when the student is exactly on the recommended lesson", () => {
  const result = buildRecommendations({
    nextItem: sequence[1],
    sequence,
    courseId: "c1",
    revisionTopics: [],
    difficultyAdjustment: "STANDARD",
    currentLessonId: "l2",
  });
  assert.ok(!result.some((r) => r.type === "PREREQUISITE"));
});

test("buildRecommendations includes PACE_ADJUSTMENT only when the pace isn't STANDARD", () => {
  const standard = buildRecommendations({ nextItem: null, sequence, courseId: "c1", revisionTopics: [], difficultyAdjustment: "STANDARD", currentLessonId: null });
  const easeUp = buildRecommendations({ nextItem: null, sequence, courseId: "c1", revisionTopics: [], difficultyAdjustment: "EASE_UP", currentLessonId: null });
  assert.ok(!standard.some((r) => r.type === "PACE_ADJUSTMENT"));
  assert.ok(easeUp.some((r) => r.type === "PACE_ADJUSTMENT"));
});

test("buildRecommendations assigns the configured fixed priority per type", () => {
  const result = buildRecommendations({ nextItem: sequence[1], sequence, courseId: "c1", revisionTopics: [], difficultyAdjustment: "STANDARD", currentLessonId: null });
  const nextLesson = result.find((r) => r.type === "NEXT_LESSON");
  assert.equal(nextLesson.priority, "HIGH");
});
