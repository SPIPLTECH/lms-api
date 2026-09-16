// Access-control tests for the AI Assistant: scope resolution, enrollment,
// hierarchy validation, conversation ownership, and the assessment boundary.
//
// Prisma is faked in require.cache so these run without a database and
// without the live data's shape (the dev DB happens to have no second
// published course, which would otherwise leave the cross-course cases
// untested — exactly the cases that matter most here).

const test = require("node:test");
const assert = require("node:assert/strict");

const prismaPath = require.resolve("../src/config/database");

/* ---------------------------- fixtures ---------------------------- */
// Course A: the student is enrolled. Course B: published, NOT enrolled.
const DB = {
  users: {
    "user-a": { id: "user-a", role: "STUDENT" },
    "user-b": { id: "user-b", role: "STUDENT" },
    "user-admin": { id: "user-admin", role: "ADMIN" },
  },
  studentProfiles: {
    "user-a": { id: "profile-a", userId: "user-a" },
    "user-b": { id: "profile-b", userId: "user-b" },
    // user-admin deliberately has no student profile.
  },
  courses: {
    "course-a": { id: "course-a", status: "PUBLISHED", visibility: "PUBLIC", creatorId: "teacher-1", title: "Course A" },
    "course-b": { id: "course-b", status: "PUBLISHED", visibility: "PUBLIC", creatorId: "teacher-1", title: "Course B" },
    "course-draft": { id: "course-draft", status: "DRAFT", visibility: "PUBLIC", creatorId: "teacher-1", title: "Draft" },
  },
  enrollments: {
    "profile-a|course-a": { id: "enr-1", studentId: "profile-a", courseId: "course-a", progressPercent: 40, completed: false },
  },
  modules: {
    "mod-a": { id: "mod-a", courseId: "course-a", title: "Module A" },
    "mod-b": { id: "mod-b", courseId: "course-b", title: "Module B" },
  },
  lessons: {
    "les-a": { id: "les-a", moduleId: "mod-a", title: "Lesson A" },
    "les-b": { id: "les-b", moduleId: "mod-b", title: "Lesson B" },
  },
  topics: {
    "top-a": { id: "top-a", lessonId: "les-a", title: "Topic A" },
    "top-b": { id: "top-b", lessonId: "les-b", title: "Topic B" },
    "top-a2": { id: "top-a2", lessonId: "les-a2", title: "Topic A2" },
  },
  lessonsExtra: { "les-a2": { id: "les-a2", moduleId: "mod-a" } },
  contents: {
    "con-a": { id: "con-a", topicId: "top-a", courseId: null, moduleId: null, lessonId: null },
    "con-a-course": { id: "con-a-course", courseId: "course-a", moduleId: null, lessonId: null, topicId: null },
    "con-a-module": { id: "con-a-module", moduleId: "mod-a", courseId: null, lessonId: null, topicId: null },
    "con-b": { id: "con-b", topicId: "top-b", courseId: null, moduleId: null, lessonId: null },
    "con-orphan": { id: "con-orphan", courseId: null, moduleId: null, lessonId: null, topicId: null },
  },
  aiConversations: {
    "conv-a": { id: "conv-a", userId: "user-a", courseId: "course-a", title: "A's chat" },
    "conv-b": { id: "conv-b", userId: "user-b", courseId: null, title: "B's chat" },
  },
};

const lessonById = (id) => DB.lessons[id] || DB.lessonsExtra[id] || null;

const fakePrisma = {
  studentProfile: {
    findUnique: async ({ where }) => DB.studentProfiles[where.userId] || null,
  },
  enrollment: {
    findUnique: async ({ where }) => {
      const { studentId, courseId } = where.studentId_courseId;
      return DB.enrollments[`${studentId}|${courseId}`] || null;
    },
  },
  course: {
    findUnique: async ({ where }) => DB.courses[where.id] || null,
  },
  module: {
    findUnique: async ({ where }) => DB.modules[where.id] || null,
    findMany: async () => [],
  },
  lesson: {
    findUnique: async ({ where }) => {
      const l = lessonById(where.id);
      if (!l) return null;
      const mod = DB.modules[l.moduleId];
      return { ...l, module: mod ? { id: mod.id, courseId: mod.courseId } : null };
    },
  },
  topic: {
    findUnique: async ({ where }) => {
      const t = DB.topics[where.id];
      if (!t) return null;
      const l = lessonById(t.lessonId);
      const mod = l ? DB.modules[l.moduleId] : null;
      return {
        ...t,
        lesson: l ? { id: l.id, module: mod ? { id: mod.id, courseId: mod.courseId } : null } : null,
      };
    },
  },
  content: {
    findUnique: async ({ where }) => {
      const c = DB.contents[where.id];
      if (!c) return null;
      const mod = c.moduleId ? DB.modules[c.moduleId] : null;
      const les = c.lessonId ? lessonById(c.lessonId) : null;
      const top = c.topicId ? DB.topics[c.topicId] : null;
      const topLesson = top ? lessonById(top.lessonId) : null;
      return {
        ...c,
        module: mod ? { courseId: mod.courseId } : null,
        lesson: les ? { module: { courseId: DB.modules[les.moduleId]?.courseId } } : null,
        topic: topLesson ? { lesson: { module: { courseId: DB.modules[topLesson.moduleId]?.courseId } } } : null,
      };
    },
    findMany: async () => [],
  },
  aiConversation: {
    findUnique: async ({ where }) => DB.aiConversations[where.id] || null,
  },
  aiMessage: { findMany: async () => [] },
};

require.cache[prismaPath] = {
  id: prismaPath, filename: prismaPath, loaded: true, exports: fakePrisma,
};

const { resolveScope, canAccessLearningContent } = require("../src/modules/ai-assistant/access/resolveScope");
const { requireEnrollment, findEnrollment, getStudentProfileId } = require("../src/modules/ai-assistant/access/requireEnrollment");
const { validateLearningPosition, isSecurityViolation } = require("../src/modules/ai-assistant/access/validateHierarchy");
const aiService = require("../src/modules/ai-assistant/aiAssistant.service");
const { SCOPE } = require("../src/modules/ai-assistant/constants/aiAssistant.constants");

const GUEST = { role: "GUEST" };
const USER_A = { id: "user-a", role: "STUDENT" };
const USER_B = { id: "user-b", role: "STUDENT" };

/* ======================= scope resolution ======================= */

test("GUEST: anonymous visitor on a published course resolves to GUEST", async () => {
  const r = await resolveScope(GUEST, "course-a");
  assert.equal(r.scope, SCOPE.GUEST);
  assert.equal(r.userId, null);
  assert.equal(canAccessLearningContent(r.scope), false);
});

test("BROWSING: signed in but not enrolled resolves to BROWSING, not ENROLLED", async () => {
  const r = await resolveScope(USER_A, "course-b");
  assert.equal(r.scope, SCOPE.BROWSING);
  assert.equal(canAccessLearningContent(r.scope), false);
});

test("ENROLLED: an actual enrollment resolves to ENROLLED", async () => {
  const r = await resolveScope(USER_A, "course-a");
  assert.equal(r.scope, SCOPE.ENROLLED);
  assert.equal(r.enrollment.id, "enr-1");
  assert.equal(canAccessLearningContent(r.scope), true);
});

test("a second student is not enrolled in the first student's course", async () => {
  const r = await resolveScope(USER_B, "course-a");
  assert.equal(r.scope, SCOPE.BROWSING);
});

test("SECURITY: a forged role=ADMIN in the token does not grant course content", async () => {
  // Even a genuine ADMIN has no StudentProfile and therefore no enrollment:
  // scope is derived from enrollment, never from the role claim.
  const r = await resolveScope({ id: "user-admin", role: "ADMIN" }, "course-a");
  assert.equal(r.scope, SCOPE.BROWSING);
  assert.equal(canAccessLearningContent(r.scope), false);
});

test("SECURITY: a client-claimed studentId cannot be used — only the JWT user id is read", async () => {
  // user-b sends user-a's profile id in the payload; it is simply not consulted.
  const r = await resolveScope({ id: "user-b", role: "STUDENT", studentId: "profile-a" }, "course-a");
  assert.equal(r.scope, SCOPE.BROWSING);
});

test("SECURITY: an unpublished course is 404 for a non-enrolled caller", async () => {
  await assert.rejects(() => resolveScope(USER_A, "course-draft"), (e) => e.statusCode === 404);
  await assert.rejects(() => resolveScope(GUEST, "course-draft"), (e) => e.statusCode === 404);
});

test("an unknown courseId is rejected", async () => {
  await assert.rejects(() => resolveScope(USER_A, "no-such-course"), (e) => e.statusCode === 404);
});

test("no courseId yields GUEST for anonymous and BROWSING for signed-in", async () => {
  assert.equal((await resolveScope(GUEST, null)).scope, SCOPE.GUEST);
  assert.equal((await resolveScope(USER_A, null)).scope, SCOPE.BROWSING);
});

/* ======================= enrollment helper ======================= */

test("enrollment resolves User id -> StudentProfile id (not User id)", async () => {
  assert.equal(await getStudentProfileId("user-a"), "profile-a");
  const enr = await findEnrollment("user-a", "course-a");
  assert.equal(enr.studentId, "profile-a");
});

test("requireEnrollment throws 403 when there is no enrollment", async () => {
  await assert.rejects(() => requireEnrollment("user-a", "course-b"), (e) => e.statusCode === 403);
  await assert.rejects(() => requireEnrollment("user-admin", "course-a"), (e) => e.statusCode === 403);
});

test("requireEnrollment returns the row when enrolled", async () => {
  const enr = await requireEnrollment("user-a", "course-a");
  assert.equal(enr.courseId, "course-a");
});

/* ======================= hierarchy validation ======================= */

test("own-course ids are accepted and the module is inferred from the lesson", async () => {
  const v = await validateLearningPosition("course-a", { lessonId: "les-a", topicId: "top-a" });
  assert.equal(v.lessonId, "les-a");
  assert.equal(v.topicId, "top-a");
  assert.equal(v.moduleId, "mod-a");
  assert.equal(v.violations.length, 0);
});

test("SECURITY: a foreign moduleId is rejected and flagged", async () => {
  const v = await validateLearningPosition("course-a", { moduleId: "mod-b" });
  assert.equal(v.moduleId, null);
  assert.ok(v.violations.some((x) => x.reason === "FOREIGN_COURSE" && isSecurityViolation(x)));
});

test("SECURITY: a foreign lessonId is rejected and flagged", async () => {
  const v = await validateLearningPosition("course-a", { lessonId: "les-b" });
  assert.equal(v.lessonId, null);
  assert.ok(v.violations.some((x) => x.reason === "FOREIGN_COURSE"));
});

test("SECURITY: a foreign topicId is rejected and flagged", async () => {
  const v = await validateLearningPosition("course-a", { topicId: "top-b" });
  assert.equal(v.topicId, null);
  assert.ok(v.violations.some((x) => x.reason === "FOREIGN_COURSE"));
});

test("SECURITY: a foreign contentId is rejected and flagged", async () => {
  const v = await validateLearningPosition("course-a", { contentIds: ["con-b"] });
  assert.deepEqual(v.contentIds, []);
  assert.ok(v.violations.some((x) => x.reason === "FOREIGN_COURSE"));
});

test("SECURITY: a mismatched hierarchy (right course, wrong parent) is rejected", async () => {
  // top-a2 is in course-a but hangs off les-a2, not the claimed les-a.
  const v = await validateLearningPosition("course-a", { lessonId: "les-a", topicId: "top-a2" });
  assert.equal(v.topicId, null);
  assert.ok(v.violations.some((x) => x.reason === "HIERARCHY_MISMATCH" && isSecurityViolation(x)));
});

test("polymorphic content: course-direct and module-direct rows resolve correctly", async () => {
  const v = await validateLearningPosition("course-a", {
    contentIds: ["con-a", "con-a-course", "con-a-module"],
  });
  assert.deepEqual(v.contentIds.sort(), ["con-a", "con-a-course", "con-a-module"]);
  assert.equal(v.violations.length, 0);
});

test("stale ids are dropped quietly and are NOT security violations", async () => {
  const v = await validateLearningPosition("course-a", {
    lessonId: "gone", topicId: "gone-too", contentIds: ["also-gone"],
  });
  assert.equal(v.lessonId, null);
  assert.deepEqual(v.contentIds, []);
  assert.ok(v.violations.every((x) => x.reason === "NOT_FOUND"));
  assert.ok(v.violations.every((x) => !isSecurityViolation(x)), "stale != attack");
});

test("orphaned content (no parent at all) is rejected", async () => {
  const v = await validateLearningPosition("course-a", { contentIds: ["con-orphan"] });
  assert.deepEqual(v.contentIds, []);
  assert.ok(v.violations.some((x) => x.reason === "ORPHANED"));
});

test("malformed / non-string ids are ignored without throwing", async () => {
  const v = await validateLearningPosition("course-a", {
    lessonId: 12345, topicId: { evil: true }, contentIds: [null, "", 7, "les-a"],
  });
  assert.equal(v.lessonId, null);
  assert.equal(v.topicId, null);
  assert.deepEqual(v.contentIds, []); // "les-a" is a lesson, not a content row
});

test("contentIds array is capped so a caller cannot force unbounded lookups", async () => {
  const many = Array.from({ length: 200 }, (_, i) => `c${i}`);
  const v = await validateLearningPosition("course-a", { contentIds: many });
  assert.ok(v.violations.length <= 20, `expected <=20 lookups, got ${v.violations.length}`);
});

/* ======================= conversation ownership ======================= */

test("SECURITY: user A cannot read user B's conversation", async () => {
  await assert.rejects(
    () => aiService.getOwnedConversation("user-a", "conv-b"),
    (e) => e.statusCode === 404
  );
});

test("a user can read their own conversation", async () => {
  const c = await aiService.getOwnedConversation("user-a", "conv-a");
  assert.equal(c.id, "conv-a");
});

test("SECURITY: cross-user access is 404, not 403, so ids cannot be probed", async () => {
  let foreign, missing;
  try { await aiService.getOwnedConversation("user-a", "conv-b"); } catch (e) { foreign = e; }
  try { await aiService.getOwnedConversation("user-a", "conv-missing"); } catch (e) { missing = e; }
  assert.equal(foreign.statusCode, missing.statusCode);
  assert.equal(foreign.message, missing.message);
});

test("an unauthenticated caller cannot reach a conversation at all", async () => {
  await assert.rejects(() => aiService.getOwnedConversation(null, "conv-a"), (e) => e.statusCode === 401);
});

test("SECURITY: getMessages enforces ownership too", async () => {
  await assert.rejects(() => aiService.getMessages(USER_A, "conv-b"), (e) => e.statusCode === 404);
});

test("SECURITY: delete and update enforce ownership", async () => {
  await assert.rejects(() => aiService.deleteConversation(USER_A, "conv-b"), (e) => e.statusCode === 404);
  await assert.rejects(() => aiService.updateConversation(USER_A, "conv-b", { title: "x" }), (e) => e.statusCode === 404);
});
