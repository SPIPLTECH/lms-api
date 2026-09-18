const test = require("node:test");
const assert = require("node:assert");

const courseService = require("../src/modules/courses/course.service");
const prisma = require("../src/config/database");

// validateCourseForPublish existed and was tested, but publishCourse never
// called it, so an instructor got no signal that a course was incomplete.
// It reports rather than blocks: most already-published courses predate the
// check and would fail it, and stranding them would be worse than the gap.

function stubCourse({ modules }) {
  // publishCourse does a plain findUnique; validateCourseForPublish does one
  // with an `include`. Branch on that so a single stub serves both.
  return async (args) => {
    const base = {
      id: "course-1",
      title: "A Course",
      description: "A description",
      status: "DRAFT",
      creatorId: "instructor-1",
      publishedAt: null,
    };
    return args?.include ? { ...base, modules } : base;
  };
}

function stubWrites(t) {
  const originals = {
    transaction: prisma.$transaction,
    courseFindUnique: prisma.course.findUnique,
  };
  t.after(() => {
    prisma.$transaction = originals.transaction;
    prisma.course.findUnique = originals.courseFindUnique;
  });
  prisma.$transaction = async (fn) =>
    fn({
      course: { update: async () => ({ id: "course-1", title: "A Course", creatorId: "instructor-1" }) },
      module: { updateMany: async () => ({ count: 0 }) },
      lesson: { updateMany: async () => ({ count: 0 }) },
      topic: { updateMany: async () => ({ count: 0 }) },
    });
}

test("publishCourse reports an incomplete course instead of blocking it", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({ modules: [] });

  const result = await courseService.publishCourse("course-1", "instructor-1", "INSTRUCTOR");

  assert.ok(Array.isArray(result.publishWarnings), "publish should return warnings");
  assert.ok(
    result.publishWarnings.some((e) => e.code === "NO_MODULES"),
    `expected NO_MODULES, got ${JSON.stringify(result.publishWarnings)}`
  );
});

test("publishCourse returns no warnings for a complete course", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({
    modules: [
      {
        title: "Module 1",
        lessons: [{ title: "Lesson 1", contents: [{ htmlContent: "<p>Real content</p>" }], topics: [] }],
      },
    ],
  });

  const result = await courseService.publishCourse("course-1", "instructor-1", "INSTRUCTOR");

  assert.deepStrictEqual(result.publishWarnings, []);
});
