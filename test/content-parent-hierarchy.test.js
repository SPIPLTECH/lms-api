const test = require("node:test");
const assert = require("node:assert");

const { createContentSchema } = require("../src/modules/contents/content.validation");
const contentService = require("../src/modules/contents/content.service");
const contentParentOwnership = require("../src/middleware/contentParentOwnership.middleware");
const prisma = require("../src/config/database");

test("Content exactly-one-parent validation", async (t) => {
  await t.test("rejects zero parents", () => {
    const { error } = createContentSchema.validate({ type: "HTML", htmlContent: "x" });
    assert.ok(error, "expected a validation error");
  });

  await t.test("rejects two parents", () => {
    const { error } = createContentSchema.validate({
      type: "HTML", htmlContent: "x", topicId: "t1", courseId: "c1",
    });
    assert.ok(error, "expected a validation error");
  });

  for (const field of ["courseId", "moduleId", "lessonId", "topicId"]) {
    await t.test(`accepts exactly ${field}`, () => {
      const { error } = createContentSchema.validate({
        type: "HTML", htmlContent: "x", [field]: "some-id",
      });
      assert.strictEqual(error, undefined, error?.message);
    });
  }
});

test("Content service — order is scoped per parent", async (t) => {
  const originalFindFirst = prisma.content.findFirst;
  const originalCreate = prisma.content.create;

  t.after(() => {
    prisma.content.findFirst = originalFindFirst;
    prisma.content.create = originalCreate;
  });

  await t.test("createContent computes order against the matching parent field only", async () => {
    const findFirstCalls = [];
    prisma.content.findFirst = async ({ where }) => {
      findFirstCalls.push(where);
      if (where.moduleId === "m1") return { order: 3 };
      return null;
    };
    prisma.content.create = async ({ data }) => ({ ...data, id: "new-id" });

    const created = await contentService.createContent({
      type: "HTML", htmlContent: "x", moduleId: "m1",
    });

    assert.deepStrictEqual(findFirstCalls, [{ moduleId: "m1" }]);
    assert.strictEqual(created.order, 4);
    assert.strictEqual(created.moduleId, "m1");
    assert.strictEqual(created.courseId, undefined);
    assert.strictEqual(created.topicId, undefined);
  });

  await t.test("createContent never strips a real lessonId parent", async () => {
    prisma.content.findFirst = async () => null;
    let capturedData;
    prisma.content.create = async ({ data }) => {
      capturedData = data;
      return { ...data, id: "new-id" };
    };

    await contentService.createContent({ type: "HTML", htmlContent: "x", lessonId: "l1" });

    assert.strictEqual(capturedData.lessonId, "l1");
  });
});

test("Content service — getContents scopes to whichever parent field is given", async (t) => {
  const originalFindMany = prisma.content.findMany;
  t.after(() => {
    prisma.content.findMany = originalFindMany;
  });

  await t.test("courseId query scopes strictly to that course", async () => {
    let capturedWhere;
    prisma.content.findMany = async ({ where }) => {
      capturedWhere = where;
      return [];
    };

    await contentService.getContents({ courseId: "c1" }, "INSTRUCTOR", "u1");

    assert.deepStrictEqual(capturedWhere, { courseId: "c1" });
  });

  await t.test("no parent id, INSTRUCTOR role, falls back to an OR across all four chains", async () => {
    let capturedWhere;
    prisma.content.findMany = async ({ where }) => {
      capturedWhere = where;
      return [];
    };

    await contentService.getContents({}, "INSTRUCTOR", "u1");

    assert.ok(Array.isArray(capturedWhere.OR));
    assert.strictEqual(capturedWhere.OR.length, 4);
  });
});

test("Content parent ownership dispatch — picks the middleware matching the body", async (t) => {
  const req = (body) => ({ body, user: { role: "INSTRUCTOR", id: "u1" } });
  const res = {};
  const calls = [];
  const next = () => calls.push("next");

  await t.test("courseId in body reaches next() when the course belongs to the caller", async () => {
    const originalFindUnique = prisma.course.findUnique;
    prisma.course.findUnique = async () => ({ id: "c1", creatorId: "u1" });
    try {
      await contentParentOwnership.fromBody(req({ courseId: "c1" }), res, next);
      assert.strictEqual(calls.pop(), "next");
    } finally {
      prisma.course.findUnique = originalFindUnique;
    }
  });

  await t.test("moduleId in body is rejected when the module's course belongs to someone else", async () => {
    const originalFindUnique = prisma.module.findUnique;
    prisma.module.findUnique = async () => ({ id: "m1", course: { creatorId: "someone-else" } });
    let errorArg;
    try {
      await contentParentOwnership.fromBody(req({ moduleId: "m1" }), res, (err) => { errorArg = err; });
    } finally {
      prisma.module.findUnique = originalFindUnique;
    }
    assert.ok(errorArg, "expected an error to be passed to next()");
    assert.strictEqual(errorArg.statusCode, 403);
  });
});
