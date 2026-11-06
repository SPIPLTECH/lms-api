const test = require("node:test");
const assert = require("node:assert");

const courseService = require("../src/modules/courses/course.service");
const prisma = require("../src/config/database");

// validateCourseForPublish reports completeness warnings when a course is
// published. Per CLAUDE.md, publish/unpublish are open to ADMIN and the owning
// INSTRUCTOR; generic status changes (archive) stay ADMIN-only.

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

test("the owning INSTRUCTOR can publish and unpublish their course", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({ modules: [] });

  const published = await courseService.publishCourse("course-1", "instructor-1", "INSTRUCTOR");
  assert.ok(Array.isArray(published.publishWarnings));

  prisma.course.findUnique = stubCourse({ modules: [], status: "PUBLISHED" });
  await courseService.unpublishCourse("course-1", "instructor-1", "INSTRUCTOR");
});

test("publishCourse and unpublishCourse reject a non-owner INSTRUCTOR and a STUDENT with 403", async (t) => {
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

test("archiving stays ADMIN-only: INSTRUCTOR (even course owner) and STUDENT get 403", async (t) => {
  stubWrites(t);
  prisma.course.findUnique = stubCourse({ modules: [] });

  for (const role of ["INSTRUCTOR", "STUDENT"]) {
    await assert.rejects(
      () => courseService.updateStatus("course-1", "ARCHIVED", "instructor-1", role),
      (err) => err.statusCode === 403
    );
  }
});
