const test = require("node:test");
const assert = require("node:assert");

const courseService = require("../src/modules/courses/course.service");
const prisma = require("../src/config/database");

function baseCourse(overrides) {
  return {
    id: "course-1",
    title: "A Course",
    description: "A description",
    modules: [],
    ...overrides
  };
}

test("validateCourseForPublish — EMPTY_LESSON handling", async (t) => {
  const originalFindUnique = prisma.course.findUnique;
  t.after(() => {
    prisma.course.findUnique = originalFindUnique;
  });

  await t.test("lesson with only lesson-level content and no topics does NOT trigger EMPTY_LESSON", async () => {
    prisma.course.findUnique = async () =>
      baseCourse({
        modules: [
          {
            title: "Module 1",
            lessons: [
              {
                title: "Lesson 1",
                contents: [
                  { htmlContent: "<p>Real content</p>" }
                ],
                topics: []
              }
            ]
          }
        ]
      });

    const result = await courseService.validateCourseForPublish("course-1");
    const emptyLessonErrors = result.errors.filter((e) => e.code === "EMPTY_LESSON");
    assert.strictEqual(emptyLessonErrors.length, 0, `expected no EMPTY_LESSON errors, got ${JSON.stringify(emptyLessonErrors)}`);
  });

  await t.test("lesson with genuinely no content (no lesson-level, no topic-level) still triggers EMPTY_LESSON", async () => {
    prisma.course.findUnique = async () =>
      baseCourse({
        modules: [
          {
            title: "Module 1",
            lessons: [
              {
                title: "Lesson 1",
                contents: [],
                topics: [
                  { title: "Topic 1", contents: [] }
                ]
              }
            ]
          }
        ]
      });

    const result = await courseService.validateCourseForPublish("course-1");
    const emptyLessonErrors = result.errors.filter((e) => e.code === "EMPTY_LESSON");
    assert.strictEqual(emptyLessonErrors.length, 1, "expected exactly one EMPTY_LESSON error");
  });

  await t.test("lesson with only topic-level content (no lesson-level) still does NOT trigger EMPTY_LESSON", async () => {
    prisma.course.findUnique = async () =>
      baseCourse({
        modules: [
          {
            title: "Module 1",
            lessons: [
              {
                title: "Lesson 1",
                contents: [],
                topics: [
                  { title: "Topic 1", contents: [{ htmlContent: "<p>Topic content</p>" }] }
                ]
              }
            ]
          }
        ]
      });

    const result = await courseService.validateCourseForPublish("course-1");
    const emptyLessonErrors = result.errors.filter((e) => e.code === "EMPTY_LESSON");
    assert.strictEqual(emptyLessonErrors.length, 0);
  });
});
