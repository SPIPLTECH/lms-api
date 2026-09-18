const test = require("node:test");
const assert = require("node:assert");

const courseService = require("../src/modules/courses/course.service");
const prisma = require("../src/config/database");

// duplicateCourse created every module, lesson and topic one at a time so it
// could read each generated id back for its children. That is two sequential
// round trips per node — 646 of them for the largest course here — against
// the 5s default transaction timeout, so duplicating a real course could not
// finish. Ids are now generated up front and each level persists in one
// createMany, which keeps the call count flat as the tree grows.

function sourceTree({ modules, lessons, topics }) {
  const content = (n) => ({
    order: 1, type: "TEXT", title: `c${n}`, videoUrl: null, fileUrl: null,
    htmlContent: "<p>x</p>", externalUrl: null, duration: null, data: null,
  });
  return {
    id: "src", title: "Source", description: "d", category: "c", level: "BEGINNER",
    thumbnailUrl: null, visibility: "PUBLIC", language: "en", tags: [],
    certificatesEnabled: true, discussionEnabled: true, estimatedLearningHours: 1,
    contents: [content("course")],
    modules: Array.from({ length: modules }, (_, m) => ({
      title: `M${m}`, description: null, order: m,
      contents: [content(`m${m}`)],
      lessons: Array.from({ length: lessons }, (_, l) => ({
        title: `L${l}`, description: null, order: l,
        contents: [content(`l${l}`)],
        topics: Array.from({ length: topics }, (_, t) => ({
          title: `T${t}`, description: null, order: t,
          contents: [content(`t${t}`)],
        })),
      })),
    })),
  };
}

// Records every delegate call the transaction body makes.
function recordingTx(calls) {
  const track = (model, op) => async (args) => {
    calls.push({ model, op, count: args?.data?.length ?? 1, data: args?.data });
    if (op === "create") return { ...args.data, id: args.data.id ?? "generated-id" };
    return { count: args?.data?.length ?? 0 };
  };
  return {
    course: { create: track("course", "create") },
    module: { createMany: track("module", "createMany"), create: track("module", "create") },
    lesson: { createMany: track("lesson", "createMany"), create: track("lesson", "create") },
    topic: { createMany: track("topic", "createMany"), create: track("topic", "create") },
    content: { createMany: track("content", "createMany"), create: track("content", "create") },
  };
}

async function runDuplicate(t, tree) {
  const originals = { findUnique: prisma.course.findUnique, transaction: prisma.$transaction };
  t.after(() => {
    prisma.course.findUnique = originals.findUnique;
    prisma.$transaction = originals.transaction;
  });
  const calls = [];
  prisma.course.findUnique = async () => tree;
  prisma.$transaction = async (fn) => fn(recordingTx(calls));
  const result = await courseService.duplicateCourse("src", "instructor-1");
  return { calls, result };
}

test("duplicateCourse issues a constant number of writes regardless of course size", async (t) => {
  const small = await runDuplicate(t, sourceTree({ modules: 1, lessons: 1, topics: 1 }));

  await t.test("a large tree costs no more calls than a small one", async (t2) => {
    const large = await runDuplicate(t2, sourceTree({ modules: 6, lessons: 5, topics: 4 }));
    assert.strictEqual(
      large.calls.length,
      small.calls.length,
      `call count must not grow with the tree: small=${small.calls.length} large=${large.calls.length}`
    );
    // 6 modules x 5 lessons x 4 topics = 120 topics; one-at-a-time would be hundreds.
    assert.ok(large.calls.length <= 10, `expected a handful of calls, got ${large.calls.length}`);
    assert.strictEqual(large.calls.filter((c) => c.op === "create" && c.model !== "course").length, 0,
      "levels must persist via createMany, not per-row create");
  });
});

test("duplicateCourse preserves the hierarchy through pre-generated ids", async (t) => {
  const { calls } = await runDuplicate(t, sourceTree({ modules: 2, lessons: 2, topics: 2 }));

  const rows = (model) => calls.filter((c) => c.model === model).flatMap((c) => c.data ?? []);
  const modules = rows("module");
  const lessons = rows("lesson");
  const topics = rows("topic");
  const contents = rows("content");

  assert.strictEqual(modules.length, 2);
  assert.strictEqual(lessons.length, 4, "2 modules x 2 lessons");
  assert.strictEqual(topics.length, 8, "4 lessons x 2 topics");

  const moduleIds = new Set(modules.map((m) => m.id));
  const lessonIds = new Set(lessons.map((l) => l.id));
  assert.ok(lessons.every((l) => moduleIds.has(l.moduleId)), "every lesson points at a created module");
  assert.ok(topics.every((tp) => lessonIds.has(tp.lessonId)), "every topic points at a created lesson");

  // 1 course-level + 2 module-level + 4 lesson-level + 8 topic-level
  assert.strictEqual(contents.length, 15, "every content row is carried over");
  assert.ok(
    contents.every((c) => c.courseId || c.moduleId || c.lessonId || c.topicId),
    "each content row keeps exactly one parent"
  );
});
