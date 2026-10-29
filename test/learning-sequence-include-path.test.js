const test = require("node:test");
const assert = require("node:assert/strict");

const prisma = require("../src/config/database");
const progressService = require("../src/modules/progress/progress.service");
const progressController = require("../src/modules/progress/progress.controller");

/**
 * GET /progress/learning-sequence?include=path returns the learning path
 * alongside the sequence, in GET /progress/learning-path's shape, from one
 * service call. Database and service are stubbed; nothing is written.
 */

const PATH = [
  { id: "lesson-1", locked: false, skippable: true, status: "current" },
  { id: "lesson-2", locked: true, skippable: false, status: "locked" },
];

function stub(t) {
  const originals = {
    profileFindUnique: prisma.studentProfile.findUnique,
    assertAccess: progressService.assertCourseProgressAccess,
    getSequence: progressService.getStudentLearningSequence,
    resolveNextItem: progressService.resolveNextItem,
  };
  t.after(() => {
    prisma.studentProfile.findUnique = originals.profileFindUnique;
    progressService.assertCourseProgressAccess = originals.assertAccess;
    progressService.getStudentLearningSequence = originals.getSequence;
    progressService.resolveNextItem = originals.resolveNextItem;
  });

  const calls = [];
  prisma.studentProfile.findUnique = async () => ({ id: "student-1" });
  progressService.assertCourseProgressAccess = async () => {};
  progressService.resolveNextItem = (path) => path[0];
  progressService.getStudentLearningSequence = async (studentId, courseId, options) => {
    calls.push({ studentId, courseId, options });
    return {
      courseId,
      steps: [],
      ...(options?.includePath && { learningPath: PATH }),
    };
  };
  return calls;
}

function run(query) {
  const req = { user: { id: "user-1", role: "STUDENT" }, query, params: {} };
  return new Promise((resolve, reject) => {
    const res = { status: () => res, json: (body) => resolve(body) };
    progressController.getLearningSequence(req, res, reject);
  });
}

test("include=path adds the learning path in /learning-path's shape", async (t) => {
  const calls = stub(t);
  const body = await run({ courseId: "course-1", include: "path" });

  assert.deepEqual(calls[0].options, { includePath: true });
  assert.deepEqual(body.data.learningPath, {
    path: PATH,
    nextItem: PATH[0],
    lockedCount: 1,
    skippableCount: 1,
  });
});

test("without include=path the response is unchanged", async (t) => {
  const calls = stub(t);
  const body = await run({ courseId: "course-1" });

  assert.deepEqual(calls[0].options, { includePath: false });
  assert.equal("learningPath" in body.data, false);
});
