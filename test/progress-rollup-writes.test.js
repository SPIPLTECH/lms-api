const test = require("node:test");
const assert = require("node:assert");

const { containerRowChanged } = require("../src/utils/progressRollup");

// The roll-up recomputes every container of a course on each call but only
// writes the rows whose stored values differ. Pure function — no database.

const at = (iso) => new Date(iso);

test("a container with no progress row yet is written", () => {
  assert.strictEqual(containerRowChanged(undefined, { completed: false, completedAt: null, visited: false, visitedAt: null }), true);
});

test("an identical row is skipped, including equal dates held as different objects", () => {
  const stored = { topicId: "t1", completed: true, completedAt: at("2026-10-01T10:00:00Z"), visited: true, visitedAt: at("2026-10-01T09:00:00Z"), qualified: false, qualifiedAt: null };
  const row = { completed: true, completedAt: at("2026-10-01T10:00:00Z"), visited: true, visitedAt: at("2026-10-01T09:00:00Z"), qualified: false, qualifiedAt: null };
  assert.strictEqual(containerRowChanged(stored, row), false);
});

test("a flag that flips is written", () => {
  const stored = { completed: false, completedAt: null, visited: true, visitedAt: at("2026-10-01T09:00:00Z") };
  assert.strictEqual(containerRowChanged(stored, { ...stored, completed: true, completedAt: at("2026-10-03T05:00:00Z") }), true);
});

test("a timestamp that moves is written", () => {
  const stored = { completed: false, completedAt: null, visited: true, visitedAt: at("2026-10-01T09:00:00Z") };
  assert.strictEqual(containerRowChanged(stored, { ...stored, visitedAt: at("2026-10-02T09:00:00Z") }), true);
});

test("a timestamp cleared to null is written", () => {
  const stored = { completed: true, completedAt: at("2026-10-01T10:00:00Z"), visited: true, visitedAt: null };
  assert.strictEqual(containerRowChanged(stored, { ...stored, completed: false, completedAt: null }), true);
});

test("qualification changes on topics and lessons are written", () => {
  const stored = { completed: false, completedAt: null, visited: false, visitedAt: null, qualified: false, qualifiedAt: null };
  assert.strictEqual(containerRowChanged(stored, { ...stored, qualified: true, qualifiedAt: at("2026-10-03T05:00:00Z") }), true);
});

test("a stored undefined and a computed null count as the same value", () => {
  const stored = { completed: false, visited: false };
  assert.strictEqual(containerRowChanged(stored, { completed: false, completedAt: null, visited: false, visitedAt: null }), false);
});

// ---------------------------------------------------------------------------
// The write pattern of a persisting roll-up, against a fake client that
// answers every read from a fixture and records every write. No database.
// ---------------------------------------------------------------------------

const { recomputeCourseProgress } = require("../src/utils/progressRollup");

const PARENTS = { courseId: null, moduleId: null, lessonId: null, topicId: null, subTopicId: null, conceptId: null };
const content = (id, topicId, order) => ({ id, title: id, type: "VIDEO", order, duration: null, quizId: null, assignmentId: null, quiz: null, assignment: null, ...PARENTS, topicId });

function fakeClient({ existingTopicRows = [], createdCount = null } = {}) {
  const writes = [];
  const progressDelegate = (name, rows = []) => ({
    findMany: async () => rows,
    upsert: async (args) => { writes.push({ model: name, op: "upsert", id: Object.values(args.where)[0] }); return {}; },
    createMany: async ({ data, skipDuplicates }) => {
      writes.push({ model: name, op: "createMany", ids: data.map((d) => d.topicId || d.lessonId || d.moduleId), skipDuplicates });
      return { count: createdCount ?? data.length };
    },
  });
  const client = {
    course: { findUnique: async () => ({ id: "c1", title: "Course", status: "PUBLISHED" }) },
    module: { findMany: async () => [{ id: "m1", title: "M", order: 1 }] },
    lesson: { findMany: async () => [{ id: "l1", title: "L", order: 1, moduleId: "m1" }] },
    topic: { findMany: async () => [{ id: "t1", title: "T1", order: 1, lessonId: "l1" }, { id: "t2", title: "T2", order: 2, lessonId: "l1" }] },
    subTopic: { findMany: async () => [] },
    concept: { findMany: async () => [] },
    content: { findMany: async () => [content("ct1", "t1", 1), content("ct2", "t2", 1)] },
    contentProgress: { findMany: async () => [{ contentId: "ct1", completed: true, completedAt: at("2026-10-01T10:00:00Z"), visited: true, visitedAt: at("2026-10-01T09:00:00Z") }] },
    quizAttempt: { findMany: async () => [] },
    topicProgress: progressDelegate("topicProgress", existingTopicRows),
    lessonProgress: progressDelegate("lessonProgress"),
    moduleProgress: progressDelegate("moduleProgress"),
    enrollment: {
      findUnique: async () => ({ id: "e1", completed: false, completedAt: null }),
      update: async () => { writes.push({ model: "enrollment", op: "update" }); return {}; },
    },
  };
  return { client, writes };
}

test("first roll-up creates missing container rows in one createMany per level; changed rows are upserted", async () => {
  // t1 has a stored row that is now out of date (its only item was completed);
  // t2, l1 and m1 have no row yet.
  const { client, writes } = fakeClient({
    existingTopicRows: [{ topicId: "t1", completed: false, completedAt: null, visited: false, visitedAt: null, qualified: false, qualifiedAt: null }],
  });

  const result = await recomputeCourseProgress("s1", "c1", client, { includeTree: true });

  assert.deepStrictEqual(
    writes.filter((w) => w.model !== "enrollment"),
    [
      { model: "topicProgress", op: "upsert", id: { studentId: "s1", topicId: "t1" } },
      { model: "topicProgress", op: "createMany", ids: ["t2"], skipDuplicates: true },
      { model: "lessonProgress", op: "createMany", ids: ["l1"], skipDuplicates: true },
      { model: "moduleProgress", op: "createMany", ids: ["m1"], skipDuplicates: true },
    ]
  );
  assert.strictEqual(writes.filter((w) => w.model === "enrollment").length, 1);

  // The flat level queries assemble the same tree the nested select produced.
  const topics = result.hierarchy.modules[0].lessons[0].topics;
  assert.deepStrictEqual(topics.map((t) => [t.id, t.items.map((i) => i.contentId), t.completed]), [
    ["t1", ["ct1"], true],
    ["t2", ["ct2"], false],
  ]);
  assert.strictEqual(result.progressPercent, 0);
});

test("rows another roll-up created in the meantime are written through upsert", async () => {
  const { client, writes } = fakeClient({ createdCount: 0 });
  await recomputeCourseProgress("s1", "c1", client, { includeTree: true });
  const topicWrites = writes.filter((w) => w.model === "topicProgress");
  assert.deepStrictEqual(topicWrites.map((w) => w.op), ["createMany", "upsert", "upsert"]);
});
