const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../src/config/database");
const ApiError = require("../src/utils/ApiError");
const { buildOwnershipCheck } = require("../src/middleware/ownership.middleware");
const verifyCourseOwnership = require("../src/middleware/courseOwnership.middleware");
const verifyModuleOwnership = require("../src/middleware/moduleOwnership.middleware");
const verifyLessonOwnership = require("../src/middleware/lessonOwnership.middleware");
const verifyTopicOwnership = require("../src/middleware/topicOwnership.middleware");
const verifyContentOwnership = require("../src/middleware/contentOwnership.middleware");
const verifyQuizOwnership = require("../src/middleware/quizOwnership.middleware");
const verifyAssignmentOwnership = require("../src/middleware/assignmentOwnership.middleware");
const verifyLiveClassOwnership = require("../src/middleware/liveClassOwnership.middleware");
const verifyConversationParticipant = require("../src/middleware/conversationOwnership.middleware");
const verifyEnrollmentOwnership = require("../src/middleware/enrollmentOwnership.middleware");
const certificateOwnership = require("../src/middleware/certificateOwnership.middleware");
const moduleService = require("../src/modules/modules/module.service");
const lessonService = require("../src/modules/lessons/lesson.service");

const OWNER_ID = "instructor-1";
const OTHER_INSTRUCTOR_ID = "instructor-2";
const ADMIN_ID = "admin-1";
const STUDENT_ID = "student-1";

const buildReq = ({ user, params = {}, body = {}, studentId } = {}) => ({
  user,
  params,
  body,
  studentId
});

const capturingNext = () => {
  const calls = [];
  const next = (arg) => calls.push(arg);
  return { next, calls };
};

// node:test's built-in `mock.method` needs a real own property descriptor to
// save/restore, but PrismaClient (v6) exposes its model delegates through a
// Proxy whose properties don't carry one — `mock.method` throws
// ERR_INVALID_ARG_VALUE against them. Plain reassignment works fine (the
// delegate objects accept normal writes), so this is a drop-in replacement
// scoped to the current test via `t.after`.
const mockMethod = (t, obj, methodName, impl) => {
  const original = obj[methodName];
  let callCount = 0;

  obj[methodName] = (...args) => {
    callCount += 1;
    return impl(...args);
  };

  t.after(() => {
    obj[methodName] = original;
  });

  return { mock: { callCount: () => callCount } };
};

// ---------------------------------------------------------------------------
// buildOwnershipCheck (the shared factory every course-ownership middleware
// in this app is built from) — exercised directly so every branch of the
// contract is proven once, rather than seven times per concrete middleware.
// ---------------------------------------------------------------------------
test("buildOwnershipCheck factory", async (t) => {
  const makeMiddleware = (resource) =>
    buildOwnershipCheck({
      getResourceId: (req) => req.params.id,
      findResource: async () => resource,
      getCourseCreatorId: (r) => r?.creatorId,
      notFoundMessage: "Resource not found"
    });

  await t.test("401 when unauthenticated", async () => {
    const middleware = makeMiddleware({ creatorId: OWNER_ID });
    const req = buildReq({ params: { id: "r1" } });
    const { next, calls } = capturingNext();

    await middleware(req, {}, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].statusCode, 401);
  });

  await t.test("404 when resource does not exist", async () => {
    const middleware = buildOwnershipCheck({
      getResourceId: (req) => req.params.id,
      findResource: async () => null,
      getCourseCreatorId: () => undefined,
      notFoundMessage: "Resource not found"
    });
    const req = buildReq({ user: { id: ADMIN_ID, role: "ADMIN" }, params: { id: "missing" } });
    const { next, calls } = capturingNext();

    await middleware(req, {}, next);

    assert.equal(calls.length, 1);
    assert.ok(calls[0] instanceof ApiError);
    assert.equal(calls[0].statusCode, 404);
  });

  await t.test("ADMIN always bypasses ownership", async () => {
    const middleware = makeMiddleware({ creatorId: OWNER_ID });
    const req = buildReq({ user: { id: ADMIN_ID, role: "ADMIN" }, params: { id: "r1" } });
    const { next, calls } = capturingNext();

    await middleware(req, {}, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0], undefined);
  });

  await t.test("STUDENT is rejected regardless of any id match", async () => {
    const middleware = makeMiddleware({ creatorId: STUDENT_ID });
    const req = buildReq({ user: { id: STUDENT_ID, role: "STUDENT" }, params: { id: "r1" } });
    const { next, calls } = capturingNext();

    await middleware(req, {}, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].statusCode, 403);
  });

  await t.test("INSTRUCTOR who does not own the resource is forbidden", async () => {
    const middleware = makeMiddleware({ creatorId: OWNER_ID });
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { id: "r1" }
    });
    const { next, calls } = capturingNext();

    await middleware(req, {}, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].statusCode, 403);
  });

  await t.test("INSTRUCTOR who owns the resource passes and it is attached to req", async () => {
    const resource = { creatorId: OWNER_ID };
    const middleware = buildOwnershipCheck({
      getResourceId: (req) => req.params.id,
      findResource: async () => resource,
      getCourseCreatorId: (r) => r.creatorId,
      attachAs: "thing"
    });
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { id: "r1" } });
    const { next, calls } = capturingNext();

    await middleware(req, {}, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0], undefined);
    assert.equal(req.thing, resource);
  });

  await t.test("400 when the resource id is missing from the request", async () => {
    const middleware = makeMiddleware({ creatorId: OWNER_ID });
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: {} });
    const { next, calls } = capturingNext();

    await middleware(req, {}, next);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].statusCode, 400);
  });
});

// ---------------------------------------------------------------------------
// Concrete course-ownership middlewares. Each is a smoke test proving the
// right Prisma relation chain is wired up (course/module/lesson/content and
// quiz/assignment/liveClass) — the branch logic itself is covered above.
// ---------------------------------------------------------------------------
test("verifyCourseOwnership", async (t) => {
  await t.test("owner instructor passes (params.courseId)", async (t) => {
    mockMethod(t, prisma.course, "findUnique", async () => ({ id: "c1", creatorId: OWNER_ID }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { courseId: "c1" } });
    const { next, calls } = capturingNext();

    await verifyCourseOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
    assert.equal(req.course.id, "c1");
  });

  await t.test("non-owner instructor is forbidden", async (t) => {
    mockMethod(t, prisma.course, "findUnique", async () => ({ id: "c1", creatorId: OWNER_ID }));
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { courseId: "c1" }
    });
    const { next, calls } = capturingNext();

    await verifyCourseOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test(".fromBody reads req.body.courseId instead of params", async (t) => {
    mockMethod(t, prisma.course, "findUnique", async () => ({ id: "c1", creatorId: OWNER_ID }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, body: { courseId: "c1" } });
    const { next, calls } = capturingNext();

    await verifyCourseOwnership.fromBody(req, {}, next);

    assert.equal(calls[0], undefined);
  });
});

test("verifyModuleOwnership walks Module -> Course", async (t) => {
  await t.test("owner instructor passes", async (t) => {
    mockMethod(t, prisma.module, "findUnique", async () => ({
      id: "m1",
      course: { creatorId: OWNER_ID }
    }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { moduleId: "m1" } });
    const { next, calls } = capturingNext();

    await verifyModuleOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-owner instructor is forbidden (fixes the old ||-precedence bug)", async (t) => {
    mockMethod(t, prisma.module, "findUnique", async () => ({
      id: "m1",
      course: { creatorId: OWNER_ID }
    }));
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { moduleId: "m1" }
    });
    const { next, calls } = capturingNext();

    await verifyModuleOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test(".fromBody reads req.body.moduleId", async (t) => {
    mockMethod(t, prisma.module, "findUnique", async () => ({
      id: "m1",
      course: { creatorId: OWNER_ID }
    }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, body: { moduleId: "m1" } });
    const { next, calls } = capturingNext();

    await verifyModuleOwnership.fromBody(req, {}, next);

    assert.equal(calls[0], undefined);
  });
});

test("verifyLessonOwnership walks Lesson -> Module -> Course", async (t) => {
  await t.test("owner instructor passes", async (t) => {
    mockMethod(t, prisma.lesson, "findUnique", async () => ({
      id: "l1",
      module: { course: { creatorId: OWNER_ID } }
    }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { lessonId: "l1" } });
    const { next, calls } = capturingNext();

    await verifyLessonOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-owner instructor is forbidden", async (t) => {
    mockMethod(t, prisma.lesson, "findUnique", async () => ({
      id: "l1",
      module: { course: { creatorId: OWNER_ID } }
    }));
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { lessonId: "l1" }
    });
    const { next, calls } = capturingNext();

    await verifyLessonOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test("STUDENT is forbidden from mutating a lesson", async (t) => {
    mockMethod(t, prisma.lesson, "findUnique", async () => ({
      id: "l1",
      module: { course: { creatorId: OWNER_ID } }
    }));
    const req = buildReq({ user: { id: STUDENT_ID, role: "STUDENT" }, params: { lessonId: "l1" } });
    const { next, calls } = capturingNext();

    await verifyLessonOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });
});

test("verifyTopicOwnership walks Topic -> Lesson -> Module -> Course", async (t) => {
  await t.test("owner instructor passes", async (t) => {
    mockMethod(t, prisma.topic, "findUnique", async () => ({
      id: "tp1",
      lesson: { module: { course: { creatorId: OWNER_ID } } }
    }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { topicId: "tp1" } });
    const { next, calls } = capturingNext();

    await verifyTopicOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-owner instructor is forbidden", async (t) => {
    mockMethod(t, prisma.topic, "findUnique", async () => ({
      id: "tp1",
      lesson: { module: { course: { creatorId: OWNER_ID } } }
    }));
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { topicId: "tp1" }
    });
    const { next, calls } = capturingNext();

    await verifyTopicOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test(".fromBody reads req.body.topicId instead of params", async (t) => {
    mockMethod(t, prisma.topic, "findUnique", async () => ({
      id: "tp1",
      lesson: { module: { course: { creatorId: OWNER_ID } } }
    }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, body: { topicId: "tp1" } });
    const { next, calls } = capturingNext();

    await verifyTopicOwnership.fromBody(req, {}, next);

    assert.equal(calls[0], undefined);
  });
});

test("verifyContentOwnership walks Content -> Topic -> Lesson -> Module -> Course", async (t) => {
  await t.test("owner instructor passes", async (t) => {
    mockMethod(t, prisma.content, "findUnique", async () => ({
      id: "ct1",
      topic: { lesson: { module: { course: { creatorId: OWNER_ID } } } }
    }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { contentId: "ct1" } });
    const { next, calls } = capturingNext();

    await verifyContentOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-owner instructor is forbidden", async (t) => {
    mockMethod(t, prisma.content, "findUnique", async () => ({
      id: "ct1",
      topic: { lesson: { module: { course: { creatorId: OWNER_ID } } } }
    }));
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { contentId: "ct1" }
    });
    const { next, calls } = capturingNext();

    await verifyContentOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test("404 when content does not exist", async (t) => {
    mockMethod(t, prisma.content, "findUnique", async () => null);
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { contentId: "gone" } });
    const { next, calls } = capturingNext();

    await verifyContentOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 404);
  });
});

test("verifyQuizOwnership", async (t) => {
  await t.test("owner instructor passes", async (t) => {
    mockMethod(t, prisma.quiz, "findUnique", async () => ({ id: "q1", course: { creatorId: OWNER_ID } }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { quizId: "q1" } });
    const { next, calls } = capturingNext();

    await verifyQuizOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-owner instructor is forbidden on nested question routes too", async (t) => {
    mockMethod(t, prisma.quiz, "findUnique", async () => ({ id: "q1", course: { creatorId: OWNER_ID } }));
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { quizId: "q1", questionId: "que1" }
    });
    const { next, calls } = capturingNext();

    await verifyQuizOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });
});

test("verifyAssignmentOwnership", async (t) => {
  await t.test("owner instructor passes", async (t) => {
    mockMethod(t, prisma.assignment, "findUnique", async () => ({
      id: "a1",
      course: { creatorId: OWNER_ID }
    }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { assignmentId: "a1" } });
    const { next, calls } = capturingNext();

    await verifyAssignmentOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-owner instructor is forbidden", async (t) => {
    mockMethod(t, prisma.assignment, "findUnique", async () => ({
      id: "a1",
      course: { creatorId: OWNER_ID }
    }));
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { assignmentId: "a1" }
    });
    const { next, calls } = capturingNext();

    await verifyAssignmentOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });
});

test("verifyLiveClassOwnership", async (t) => {
  await t.test("owner instructor passes", async (t) => {
    mockMethod(t, prisma.liveClass, "findUnique", async () => ({
      id: "lc1",
      course: { creatorId: OWNER_ID }
    }));
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { liveClassId: "lc1" } });
    const { next, calls } = capturingNext();

    await verifyLiveClassOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-owner instructor is forbidden", async (t) => {
    mockMethod(t, prisma.liveClass, "findUnique", async () => ({
      id: "lc1",
      course: { creatorId: OWNER_ID }
    }));
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { liveClassId: "lc1" }
    });
    const { next, calls } = capturingNext();

    await verifyLiveClassOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });
});

// ---------------------------------------------------------------------------
// Bespoke middlewares: conversation (membership, not ownership), enrollment
// (self-service for students only), certificate (dual read access / write).
// ---------------------------------------------------------------------------
test("verifyConversationParticipant", async (t) => {
  await t.test("participant passes", async (t) => {
    mockMethod(t, prisma.conversation, "findUnique", async () => ({ id: "conv1" }));
    mockMethod(t, prisma.conversationParticipant, "findFirst", async () => ({ id: "p1" }));
    const req = buildReq({ user: { id: STUDENT_ID, role: "STUDENT" }, params: { conversationId: "conv1" } });
    const { next, calls } = capturingNext();

    await verifyConversationParticipant(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-participant is forbidden", async (t) => {
    mockMethod(t, prisma.conversation, "findUnique", async () => ({ id: "conv1" }));
    mockMethod(t, prisma.conversationParticipant, "findFirst", async () => null);
    const req = buildReq({ user: { id: STUDENT_ID, role: "STUDENT" }, params: { conversationId: "conv1" } });
    const { next, calls } = capturingNext();

    await verifyConversationParticipant(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test("ADMIN bypasses participant check", async (t) => {
    mockMethod(t, prisma.conversation, "findUnique", async () => ({ id: "conv1" }));
    const participantLookup = mockMethod(t, prisma.conversationParticipant, "findFirst", async () => null);
    const req = buildReq({ user: { id: ADMIN_ID, role: "ADMIN" }, params: { conversationId: "conv1" } });
    const { next, calls } = capturingNext();

    await verifyConversationParticipant(req, {}, next);

    assert.equal(calls[0], undefined);
    assert.equal(participantLookup.mock.callCount(), 0);
  });

  await t.test("404 when conversation does not exist", async (t) => {
    mockMethod(t, prisma.conversation, "findUnique", async () => null);
    const req = buildReq({ user: { id: STUDENT_ID, role: "STUDENT" }, params: { conversationId: "gone" } });
    const { next, calls } = capturingNext();

    await verifyConversationParticipant(req, {}, next);

    assert.equal(calls[0].statusCode, 404);
  });
});

test("verifyEnrollmentOwnership", async (t) => {
  await t.test("student removing their own enrollment passes", async (t) => {
    mockMethod(t, prisma.enrollment, "findUnique", async () => ({ id: "e1", studentId: "sp1" }));
    const req = buildReq({
      user: { id: STUDENT_ID, role: "STUDENT" },
      params: { enrollmentId: "e1" },
      studentId: "sp1"
    });
    const { next, calls } = capturingNext();

    await verifyEnrollmentOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("student cannot remove another student's enrollment", async (t) => {
    mockMethod(t, prisma.enrollment, "findUnique", async () => ({ id: "e1", studentId: "someone-else" }));
    const req = buildReq({
      user: { id: STUDENT_ID, role: "STUDENT" },
      params: { enrollmentId: "e1" },
      studentId: "sp1"
    });
    const { next, calls } = capturingNext();

    await verifyEnrollmentOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test("ADMIN keeps full control regardless of studentId", async (t) => {
    mockMethod(t, prisma.enrollment, "findUnique", async () => ({ id: "e1", studentId: "someone-else" }));
    const req = buildReq({ user: { id: ADMIN_ID, role: "ADMIN" }, params: { enrollmentId: "e1" } });
    const { next, calls } = capturingNext();

    await verifyEnrollmentOwnership(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("404 when enrollment does not exist", async (t) => {
    mockMethod(t, prisma.enrollment, "findUnique", async () => null);
    const req = buildReq({ user: { id: STUDENT_ID, role: "STUDENT" }, params: { enrollmentId: "gone" } });
    const { next, calls } = capturingNext();

    await verifyEnrollmentOwnership(req, {}, next);

    assert.equal(calls[0].statusCode, 404);
  });
});

test("certificateOwnership.verifyCertificateAccess", async (t) => {
  const certificate = {
    id: "cert1",
    student: { userId: STUDENT_ID },
    course: { creatorId: OWNER_ID }
  };

  await t.test("owning student can read their certificate", async (t) => {
    mockMethod(t, prisma.certificate, "findUnique", async () => certificate);
    const req = buildReq({ user: { id: STUDENT_ID, role: "STUDENT" }, params: { certificateId: "cert1" } });
    const { next, calls } = capturingNext();

    await certificateOwnership.verifyCertificateAccess(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("a different student cannot read someone else's certificate", async (t) => {
    mockMethod(t, prisma.certificate, "findUnique", async () => certificate);
    const req = buildReq({ user: { id: "student-2", role: "STUDENT" }, params: { certificateId: "cert1" } });
    const { next, calls } = capturingNext();

    await certificateOwnership.verifyCertificateAccess(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test("owning instructor can read", async (t) => {
    mockMethod(t, prisma.certificate, "findUnique", async () => certificate);
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { certificateId: "cert1" } });
    const { next, calls } = capturingNext();

    await certificateOwnership.verifyCertificateAccess(req, {}, next);

    assert.equal(calls[0], undefined);
  });

  await t.test("non-owning instructor is forbidden", async (t) => {
    mockMethod(t, prisma.certificate, "findUnique", async () => certificate);
    const req = buildReq({
      user: { id: OTHER_INSTRUCTOR_ID, role: "INSTRUCTOR" },
      params: { certificateId: "cert1" }
    });
    const { next, calls } = capturingNext();

    await certificateOwnership.verifyCertificateAccess(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });
});

test("certificateOwnership.verifyCertificateManage", async (t) => {
  const certificate = {
    id: "cert1",
    student: { userId: STUDENT_ID },
    course: { creatorId: OWNER_ID }
  };

  await t.test("a student can never manage a certificate, even their own", async (t) => {
    mockMethod(t, prisma.certificate, "findUnique", async () => certificate);
    const req = buildReq({ user: { id: STUDENT_ID, role: "STUDENT" }, params: { certificateId: "cert1" } });
    const { next, calls } = capturingNext();

    await certificateOwnership.verifyCertificateManage(req, {}, next);

    assert.equal(calls[0].statusCode, 403);
  });

  await t.test("owning instructor can manage", async (t) => {
    mockMethod(t, prisma.certificate, "findUnique", async () => certificate);
    const req = buildReq({ user: { id: OWNER_ID, role: "INSTRUCTOR" }, params: { certificateId: "cert1" } });
    const { next, calls } = capturingNext();

    await certificateOwnership.verifyCertificateManage(req, {}, next);

    assert.equal(calls[0], undefined);
  });
});

// ---------------------------------------------------------------------------
// "Never trust IDs from frontend": the top-level ownership middleware only
// proves the caller owns the parent (course/module) — these guards inside
// the reorder services prove every child id in the request body actually
// belongs to that parent before anything is written.
// ---------------------------------------------------------------------------
test("moduleService.reorderModules rejects module ids smuggled from another course", async (t) => {
  mockMethod(t, prisma.module, "findMany", async () => [{ id: "m1" }, { id: "m2" }]);
  const updateMock = mockMethod(t, prisma.module, "update", async ({ where, data }) => ({ id: where.id, ...data }));
  const transactionMock = mockMethod(t, prisma, "$transaction", async (ops) => Promise.all(ops));

  await assert.rejects(
    () =>
      moduleService.reorderModules("course-1", [
        { id: "m1", order: 1 },
        { id: "m2", order: 2 },
        { id: "smuggled-from-other-course", order: 3 }
      ]),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.statusCode, 403);
      return true;
    }
  );

  assert.equal(updateMock.mock.callCount(), 0);
  assert.equal(transactionMock.mock.callCount(), 0);
});

test("moduleService.reorderModules succeeds when every id belongs to the course", async (t) => {
  mockMethod(t, prisma.module, "findMany", async () => [{ id: "m1" }, { id: "m2" }]);
  mockMethod(t, prisma.module, "update", async ({ where, data }) => ({ id: where.id, ...data }));
  mockMethod(t, prisma, "$transaction", async (ops) => Promise.all(ops));

  const result = await moduleService.reorderModules("course-1", [
    { id: "m1", order: 1 },
    { id: "m2", order: 2 }
  ]);

  assert.equal(result.length, 2);
});

test("lessonService.reorderLessons rejects lesson ids smuggled from another module", async (t) => {
  mockMethod(t, prisma.lesson, "findMany", async () => [{ id: "l1" }]);
  const updateMock = mockMethod(t, prisma.lesson, "update", async ({ where, data }) => ({ id: where.id, ...data }));
  const transactionMock = mockMethod(t, prisma, "$transaction", async (ops) => Promise.all(ops));

  await assert.rejects(
    () =>
      lessonService.reorderLessons("module-1", [
        { id: "l1", order: 1 },
        { id: "smuggled-from-other-module", order: 2 }
      ]),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.statusCode, 403);
      return true;
    }
  );

  assert.equal(updateMock.mock.callCount(), 0);
  assert.equal(transactionMock.mock.callCount(), 0);
});

test("lessonService.reorderLessons succeeds and uses the id field (not the old lessonId typo)", async (t) => {
  mockMethod(t, prisma.lesson, "findMany", async () => [{ id: "l1" }, { id: "l2" }]);
  mockMethod(t, prisma.lesson, "update", async ({ where, data }) => ({ id: where.id, ...data }));
  mockMethod(t, prisma, "$transaction", async (ops) => Promise.all(ops));

  const result = await lessonService.reorderLessons("module-1", [
    { id: "l1", order: 1 },
    { id: "l2", order: 2 }
  ]);

  assert.equal(result.length, 2);
  assert.equal(result[0].id, "l1");
  assert.equal(result[1].id, "l2");
});
