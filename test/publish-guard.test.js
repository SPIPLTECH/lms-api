const test = require("node:test");
const assert = require("node:assert");

const courseService = require("../src/modules/courses/course.service");
const prisma = require("../src/config/database");

// validateCourseForPublish reports completeness warnings when an ADMIN publishes
// a course. An ADMIN or the course's own INSTRUCTOR may publish and unpublish it;
// other status changes (archive, the admin status menu) are ADMIN-only.

function stubCourse({ modules = [], status = "DRAFT" } = {}) {
  return async (args) => {
    const base = {
      id: "course-1",
      title: "A Course",
      description: "A description",
      status,
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
    courseUpdate: prisma.course.update,
  };
  t.after(() => {
    prisma.$transaction = originals.transaction;
    prisma.course.findUnique = originals.courseFindUnique;
    prisma.course.update = originals.courseUpdate;
  });
  prisma.course.update = async () => ({
    id: "course-1",
    title: "A Course",
    creatorId: "instructor-1",
    status: "DRAFT",
  });
  prisma.$transaction = async (fn) =>
    fn({
      course: { update: async () => ({ id: "course-1", title: "A Course", creatorId: "instructor-1" }) },
      module: { updateMany: async () => ({ count: 0 }) },
      lesson: { updateMany: async () => ({ count: 0 }) },
      topic: { updateMany: async () => ({ count: 0 }) },
      subTopic: { updateMany: async () => ({ count: 0 }) },
      concept: { updateMany: async () => ({ count: 0 }) },
    });
}

test("publishCourse reports an incomplete course instead of blocking an ADMIN", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({ modules: [] });

  const result = await courseService.publishCourse("course-1", "admin-1", "ADMIN");

  assert.ok(Array.isArray(result.publishWarnings), "publish should return warnings");
  assert.ok(
    result.publishWarnings.some((e) => e.code === "NO_MODULES"),
    `expected NO_MODULES, got ${JSON.stringify(result.publishWarnings)}`
  );
});

test("publishCourse returns no warnings for a complete course published by ADMIN", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({
    modules: [
      {
        title: "Module 1",
        lessons: [{ title: "Lesson 1", contents: [{ htmlContent: "<p>Real content</p>" }], topics: [] }],
      },
    ],
  });

  const result = await courseService.publishCourse("course-1", "admin-1", "ADMIN");

  assert.deepStrictEqual(result.publishWarnings, []);
});

test("the course's own INSTRUCTOR can publish and unpublish it", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({ modules: [] });

  const published = await courseService.publishCourse("course-1", "instructor-1", "INSTRUCTOR");
  assert.ok(Array.isArray(published.publishWarnings), "the owner gets the same completeness warnings");
  const unpublished = await courseService.unpublishCourse("course-1", "instructor-1", "INSTRUCTOR");
  assert.strictEqual(unpublished.status, "DRAFT");
});

test("another INSTRUCTOR and a STUDENT cannot publish or unpublish a course", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({ modules: [] });

  for (const [userId, role] of [["instructor-2", "INSTRUCTOR"], ["instructor-1", "STUDENT"]]) {
    await assert.rejects(
      () => courseService.publishCourse("course-1", userId, role),
      (err) => err.statusCode === 403
    );
    await assert.rejects(
      () => courseService.unpublishCourse("course-1", userId, role),
      (err) => err.statusCode === 403
    );
  }
});

test("archiving stays ADMIN-only, even for the course's own INSTRUCTOR", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({ modules: [], status: "PUBLISHED" });

  for (const role of ["INSTRUCTOR", "STUDENT"]) {
    await assert.rejects(
      () => courseService.updateStatus("course-1", "ARCHIVED", "instructor-1", role),
      (err) => err.statusCode === 403
    );
  }
});
