const test = require("node:test");
const assert = require("node:assert");

const { createContentSchema } = require("../src/modules/contents/content.validation");
const contentService = require("../src/modules/contents/content.service");
const contentParentOwnership = require("../src/middleware/contentParentOwnership.middleware");
const prisma = require("../src/config/database");
const { createTransactionStub } = require("./sequence-db.fake");

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

  for (const field of ["courseId", "moduleId", "lessonId", "topicId", "subTopicId", "conceptId"]) {
    await t.test(`accepts exactly ${field}`, () => {
      const { error } = createContentSchema.validate({
        type: "HTML", htmlContent: "x", [field]: "some-id",
      });
      assert.strictEqual(error, undefined, error?.message);
    });
  }

  // The two new levels must be mutually exclusive with the old ones in both
  // directions, so Concept content can never be mistaken for Topic content.
  await t.test("rejects topicId + subTopicId together", () => {
    const { error } = createContentSchema.validate({
      type: "HTML", htmlContent: "x", topicId: "t1", subTopicId: "st1",
    });
    assert.ok(error, "expected a validation error");
  });

  await t.test("rejects subTopicId + conceptId together", () => {
    const { error } = createContentSchema.validate({
      type: "HTML", htmlContent: "x", subTopicId: "st1", conceptId: "cn1",
    });
    assert.ok(error, "expected a validation error");
  });
});

test("Content service — order is scoped per parent", async (t) => {
  const originalCreate = prisma.content.create;
  const originalTransaction = prisma.$transaction;

  t.after(() => {
    prisma.content.create = originalCreate;
    prisma.$transaction = originalTransaction;
  });

  await t.test("createContent computes order against the matching parent field only", async () => {
    // The parent's last item is at 3 (whatever type it is), so the new content
    // takes 4. createContent claims that inside prisma.$transaction now.
    const stub = createTransactionStub(prisma, { maxOrderByDelegate: { content: 3 } });
    prisma.$transaction = stub.$transaction;
    prisma.content.create = async ({ data }) => ({ ...data, id: "new-id" });

    const created = await contentService.createContent({
      type: "HTML", htmlContent: "x", moduleId: "m1",
    });

    // Every lookup was scoped to this module, and to no other parent.
    assert.ok(stub.aggregateCalls.length > 0);
    for (const call of stub.aggregateCalls) {
      assert.strictEqual(call.where.moduleId, "m1");
      assert.strictEqual(call.where.courseId, undefined);
      assert.strictEqual(call.where.topicId ?? null, null);
    }
    assert.strictEqual(created.order, 4);
    assert.strictEqual(created.moduleId, "m1");
    assert.strictEqual(created.courseId, undefined);
    assert.strictEqual(created.topicId, undefined);
  });

  await t.test("createContent never strips a real lessonId parent", async () => {
    prisma.$transaction = createTransactionStub(prisma).$transaction;
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

  await t.test("no parent id, INSTRUCTOR role, falls back to an OR across all six chains", async () => {
    let capturedWhere;
    prisma.content.findMany = async ({ where }) => {
      capturedWhere = where;
      return [];
    };

    await contentService.getContents({}, "INSTRUCTOR", "u1");

    // Six, not four: SubTopic- and Concept-attached content belonging to this
    // instructor must appear in their own listing too. A missing chain here
    // would silently hide an instructor's own content from them.
    assert.ok(Array.isArray(capturedWhere.OR));
    assert.strictEqual(capturedWhere.OR.length, 6);
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
