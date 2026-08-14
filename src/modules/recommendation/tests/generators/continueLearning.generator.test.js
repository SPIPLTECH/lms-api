const test = require("node:test");
const assert = require("node:assert/strict");

const { generate } = require("../../services/domain/generators/continueLearning.generator");
const { makeContext } = require("../helpers/makeContext");

test("continueLearning.generate returns nothing when there is no current course", () => {
  const context = makeContext({ learningState: { progress: { currentCourseId: null } } });
  assert.deepEqual(generate(context), []);
});

test("continueLearning.generate returns nothing once the course is fully complete", () => {
  const context = makeContext({
    learningState: { progress: { currentCourseId: "course_1", courseCompletionPercent: 100 }, engagement: {} },
  });
  assert.deepEqual(generate(context), []);
});

test("continueLearning.generate recommends the in-progress course", () => {
  const context = makeContext({
    learningState: {
      progress: { currentCourseId: "course_1", currentModuleId: "mod_1", currentLessonId: "lesson_1", courseCompletionPercent: 40 },
      engagement: { lastActiveAt: new Date("2026-01-09T00:00:00.000Z") },
    },
  });

  const [candidate] = generate(context);
  assert.equal(candidate.type, "CONTINUE_LEARNING");
  assert.equal(candidate.dedupeKey, "course_1");
  assert.equal(candidate.courseId, "course_1");
});

test("continueLearning.generate raises urgency the longer the student has been idle", () => {
  const recentlyActive = generate(
    makeContext({
      learningState: {
        progress: { currentCourseId: "course_1", courseCompletionPercent: 40 },
        engagement: { lastActiveAt: new Date("2026-01-09T23:00:00.000Z") },
      },
    })
  )[0];

  const longIdle = generate(
    makeContext({
      learningState: {
        progress: { currentCourseId: "course_1", courseCompletionPercent: 40 },
        engagement: { lastActiveAt: new Date("2025-12-01T00:00:00.000Z") },
      },
    })
  )[0];

  assert.ok(longIdle.urgency > recentlyActive.urgency);
});
