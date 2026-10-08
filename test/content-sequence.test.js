const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const contentService = require("../src/modules/contents/content.service");
const quizService = require("../src/modules/quizzes/quiz.service");
const assignmentService = require("../src/modules/assignments/assignment.service");
const moduleService = require("../src/modules/modules/module.service");
const lessonService = require("../src/modules/lessons/lesson.service");
const topicService = require("../src/modules/topics/topic.service");
const subTopicService = require("../src/modules/subTopic/subTopic.service");
const conceptService = require("../src/modules/concept/concept.service");
const { validateContentDataInvariants } = contentService;
const { buildLearningSequence } = require("../src/utils/learningSequence");
const { createSequenceDb } = require("./sequence-db.fake");

/**
 * ONE learning sequence per parent, in the order things were added: the
 * parent's Content rows (ordinary content, Content(type=QUIZ),
 * Content(type=ASSIGNMENT)) and its child containers share it, at every
 * level from Course down to Concept. Runs the real services against an
 * in-memory database (test/sequence-db.fake.js) — nothing touches a real one.
 */

const COURSE = "course1";

function useSequenceDb(t) {
  const db = createSequenceDb();
  const patched = [];
  const patch = (target, key, value) => {
    patched.push([target, key, target[key]]);
    target[key] = value;
  };

  // Containers resolve their ancestors the way Prisma's nested selects do.
  const flat = Object.fromEntries(["module", "lesson", "topic", "subTopic", "concept"].map((n) => [n, db[n].findUnique]));
  const course = { id: COURSE, status: "DRAFT", title: "Java Programming", creatorId: "teacher" };
  db.module.findUnique = async (args) => {
    const row = await flat.module(args);
    return row ? { ...row, course } : null;
  };
  db.lesson.findUnique = async (args) => {
    const row = await flat.lesson(args);
    return row ? { ...row, module: await db.module.findUnique({ where: { id: row.moduleId } }) } : null;
  };
  db.topic.findUnique = async (args) => {
    const row = await flat.topic(args);
    return row ? { ...row, lesson: await db.lesson.findUnique({ where: { id: row.lessonId } }) } : null;
  };
  db.subTopic.findUnique = async (args) => {
    const row = await flat.subTopic(args);
    return row ? { ...row, topic: await db.topic.findUnique({ where: { id: row.topicId } }) } : null;
  };
  db.concept.findUnique = async (args) => {
    const row = await flat.concept(args);
    return row ? { ...row, subTopic: await db.subTopic.findUnique({ where: { id: row.subTopicId } }) } : null;
  };

  patch(prisma, "$transaction", db.$transaction);
  patch(prisma.course, "findUnique", async () => course);
  for (const name of ["content", "quiz", "assignment", "module", "lesson", "topic", "subTopic", "concept"]) {
    patch(prisma[name], "findUnique", db[name].findUnique);
    patch(prisma[name], "findMany", db[name].findMany);
  }

  t.after(() => {
    for (const [target, key, original] of patched.reverse()) target[key] = original;
  });
  return db;
}

const video = (parent, title) => contentService.createContent({ ...parent, type: "VIDEO", title });
const content = (parent, type, title, order) => contentService.createContent({ ...parent, type, title, order });
const quiz = (parent, title, extra = {}) =>
  quizService.createQuiz({ courseId: COURSE, ...parent, title, passingScore: 70, quizTag: "FINAL", isPublished: false, ...extra });
const assignment = (parent, title, extra = {}) =>
  assignmentService.createAssignment({ ...parent, title, dueDate: "2026-12-01T00:00:00.000Z", ...extra });

test("the course example: content, modules, quizzes and assignments run in the order they were added", async (t) => {
  const db = useSequenceDb(t);
  await video({ courseId: COURSE }, "Welcome video");
  await moduleService.createModule({ courseId: COURSE, title: "Introduction to Java" });
  await content({ courseId: COURSE }, "IMAGE", "Course map image");
  await quiz({}, "Course Quiz");
  await assignment({ courseId: COURSE }, "Course Assignment");
  await moduleService.createModule({ courseId: COURSE, title: "Variables" });

  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "VIDEO:Welcome video@1",
    "MODULE:Introduction to Java@2",
    "IMAGE:Course map image@3",
    "QUIZ:Course Quiz@4",
    "ASSIGNMENT:Course Assignment@5",
    "MODULE:Variables@6",
  ]);
  // Quiz.order / Assignment.order are not used: the Content row is the place.
  assert.strictEqual(db.tables.quiz[0].order, undefined);
  assert.strictEqual(db.tables.assignment[0].order, undefined);
});

test("the same rule holds at every level: Module, Lesson, Topic, SubTopic and Concept", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  await video({ moduleId: mod.id }, "Module intro");
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  await quiz({ moduleId: mod.id }, "Module quiz");

  await assignment({ lessonId: lesson.id }, "Lesson assignment");
  const topic = await topicService.createTopic({ lessonId: lesson.id, title: "T1" });
  await content({ lessonId: lesson.id }, "IMAGE", "Lesson image");

  await content({ topicId: topic.id }, "TEXT", "Topic text");
  const subTopic = await subTopicService.createSubTopic({ topicId: topic.id, title: "S1" });
  await quiz({ moduleId: mod.id, lessonId: lesson.id, topicId: topic.id }, "Topic quiz");

  const concept = await conceptService.createConcept({ subTopicId: subTopic.id, title: "C1" });
  await video({ subTopicId: subTopic.id }, "SubTopic video");

  await video({ conceptId: concept.id }, "Video");
  await content({ conceptId: concept.id }, "PDF", "PDF");
  await quiz({ moduleId: mod.id, lessonId: lesson.id, topicId: topic.id, subTopicId: subTopic.id, conceptId: concept.id }, "Quiz");
  await assignment({ conceptId: concept.id }, "Assignment");
  await content({ conceptId: concept.id }, "TEXT", "Text");

  assert.deepStrictEqual(db.sequenceOf("moduleId", mod.id), ["VIDEO:Module intro@1", "LESSON:L1@2", "QUIZ:Module quiz@3"]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["ASSIGNMENT:Lesson assignment@1", "TOPIC:T1@2", "IMAGE:Lesson image@3"]);
  assert.deepStrictEqual(db.sequenceOf("topicId", topic.id), ["TEXT:Topic text@1", "SUBTOPIC:S1@2", "QUIZ:Topic quiz@3"]);
  assert.deepStrictEqual(db.sequenceOf("subTopicId", subTopic.id), ["CONCEPT:C1@1", "VIDEO:SubTopic video@2"]);
  assert.deepStrictEqual(db.sequenceOf("conceptId", concept.id), [
    "VIDEO:Video@1",
    "PDF:PDF@2",
    "QUIZ:Quiz@3",
    "ASSIGNMENT:Assignment@4",
    "TEXT:Text@5",
  ]);
  // A quiz carrying ancestor ids is placed at its most specific parent only.
  const conceptQuizRow = db.tables.content.find((row) => row.title === "Quiz");
  assert.strictEqual(conceptQuizRow.conceptId, concept.id);
  assert.strictEqual(conceptQuizRow.topicId, null);
});

test("inserting at a position moves every later item of any kind down one", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  await video({ lessonId: lesson.id }, "Intro");
  await topicService.createTopic({ lessonId: lesson.id, title: "T1" });
  await content({ lessonId: lesson.id }, "TEXT", "Summary");

  await quiz({ moduleId: mod.id, lessonId: lesson.id }, "Check", { order: 2 });
  await topicService.createTopic({ lessonId: lesson.id, title: "T0", order: 1 });

  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), [
    "TOPIC:T0@1",
    "VIDEO:Intro@2",
    "QUIZ:Check@3",
    "TOPIC:T1@4",
    "TEXT:Summary@5",
  ]);
});

test("each container is its own boundary: a lesson-level block added after its topics lands after them, outside every topic", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "Java Basics" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "Control Flow" });
  await topicService.createTopic({ lessonId: lesson.id, title: "Conditionals" });
  const loops = await topicService.createTopic({ lessonId: lesson.id, title: "Loops" });
  await video({ topicId: loops.id }, "For loops");

  // No order sent (what the composer now does for "Add Content"): appended.
  const image = await content({ lessonId: lesson.id }, "IMAGE", "Image");
  await topicService.createTopic({ lessonId: lesson.id, title: "Sample topic" });
  // "Add Below" the Image: the anchor's position + 1, ahead of the later topic.
  await content({ lessonId: lesson.id }, "TEXT", "Caption", image.order + 1);

  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), [
    "TOPIC:Conditionals@1",
    "TOPIC:Loops@2",
    "IMAGE:Image@3",
    "TEXT:Caption@4",
    "TOPIC:Sample topic@5",
  ]);
  assert.deepStrictEqual(db.sequenceOf("topicId", loops.id), ["VIDEO:For loops@1"], "a topic's own sequence is untouched by its lesson's");
  assert.deepStrictEqual(db.sequenceOf("moduleId", mod.id), ["LESSON:Control Flow@1"]);
});

test("swapping two containers keeps the content between them in place", async (t) => {
  const db = useSequenceDb(t);
  const m1 = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  await video({ courseId: COURSE }, "Between");
  const m2 = await moduleService.createModule({ courseId: COURSE, title: "M2" });

  await moduleService.reorderModules(COURSE, [
    { id: m1.id, order: m2.order },
    { id: m2.id, order: m1.order },
  ]);
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), ["MODULE:M2@1", "VIDEO:Between@2", "MODULE:M1@3"]);
});

test("removing an item closes its slot across both kinds", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  const intro = await video({ lessonId: lesson.id }, "Intro");
  const t1 = await topicService.createTopic({ lessonId: lesson.id, title: "T1" });
  const q = await quiz({ moduleId: mod.id, lessonId: lesson.id }, "Check");
  await topicService.createTopic({ lessonId: lesson.id, title: "T2" });

  await contentService.deleteContent(intro.id);
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["TOPIC:T1@1", "QUIZ:Check@2", "TOPIC:T2@3"]);

  await quizService.deleteQuiz(q.id);
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["TOPIC:T1@1", "TOPIC:T2@2"]);
  assert.strictEqual(db.tables.quiz.length, 0, "the quiz goes with its place in the sequence");

  await topicService.deleteTopic(t1.id);
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["TOPIC:T2@1"]);
});

test("reorder: a Content row swaps with a neighbouring container; positions stay unique 1..n", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  const intro = await video({ lessonId: lesson.id }, "Intro");
  const t1 = await topicService.createTopic({ lessonId: lesson.id, title: "T1" });
  const img = await content({ lessonId: lesson.id }, "IMAGE", "Image");

  // The Course Map's swap: Image (3) up past T1 (2).
  await contentService.reorderContents({
    parentType: "lesson",
    parentId: lesson.id,
    contents: [
      { id: img.id, order: 2 },
      { id: t1.id, order: 3 },
    ],
  });
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["VIDEO:Intro@1", "IMAGE:Image@2", "TOPIC:T1@3"]);

  // The full-order form.
  await contentService.reorderContents({ parentType: "lesson", parentId: lesson.id, orderedIds: [t1.id, img.id, intro.id] });
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["TOPIC:T1@1", "IMAGE:Image@2", "VIDEO:Intro@3"]);

  // A container reorder moves the container within the shared sequence.
  await topicService.reorderTopics(lesson.id, [{ id: t1.id, order: 3 }]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["IMAGE:Image@1", "VIDEO:Intro@2", "TOPIC:T1@3"]);
});

test("reorder refuses duplicates, strangers and incomplete lists", async (t) => {
  useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  const a = await video({ lessonId: lesson.id }, "A");
  const b = await video({ lessonId: lesson.id }, "B");
  const other = await video({ moduleId: mod.id }, "Elsewhere");

  const fails = (payload) => assert.rejects(() => contentService.reorderContents(payload), (error) => error.statusCode === 400);
  await fails({ parentType: "lesson", parentId: lesson.id, contents: [{ id: a.id, order: 1 }, { id: a.id, order: 2 }] });
  await fails({ parentType: "lesson", parentId: lesson.id, contents: [{ id: other.id, order: 1 }] });
  await fails({ parentType: "lesson", parentId: lesson.id, orderedIds: [a.id] });
  await fails({ parentType: "lesson", parentId: lesson.id, orderedIds: [a.id, b.id, b.id] });
});

test("swap-order trades two items of any kind in one parent, never leaving a position held twice", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  const intro = await video({ lessonId: lesson.id }, "Intro");
  const topic = await topicService.createTopic({ lessonId: lesson.id, title: "T1" });
  const q = await quiz({ moduleId: mod.id, lessonId: lesson.id }, "Check");

  // A Content row with a Topic: two tables, one sequence.
  const swapped = await contentService.swapSequenceOrder({ kind: "content", id: intro.id }, { kind: "topic", id: topic.id });
  assert.deepStrictEqual(swapped, [
    { kind: "content", id: intro.id, order: 2 },
    { kind: "topic", id: topic.id, order: 1 },
  ]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["TOPIC:T1@1", "VIDEO:Intro@2", "QUIZ:Check@3"]);

  // A quiz is named by its own id and moves through its Content row.
  await contentService.swapSequenceOrder({ kind: "quiz", id: q.id }, { kind: "topic", id: topic.id });
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["QUIZ:Check@1", "VIDEO:Intro@2", "TOPIC:T1@3"]);
});

test("swap-order refuses other parents, itself, standalone quizzes and other instructors' courses", async (t) => {
  useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  const here = await video({ lessonId: lesson.id }, "Here");
  const there = await video({ moduleId: mod.id }, "There");
  const skip = await quiz({ moduleId: mod.id, lessonId: lesson.id }, "Skip test", { quizTag: "QUALIFYING" });

  const fails = (first, second, status, user) =>
    assert.rejects(() => contentService.swapSequenceOrder(first, second, user), (error) => error.statusCode === status);
  await fails({ kind: "content", id: here.id }, { kind: "content", id: there.id }, 400);
  await fails({ kind: "content", id: here.id }, { kind: "content", id: here.id }, 400);
  await fails({ kind: "quiz", id: skip.id }, { kind: "content", id: here.id }, 404);
  await fails({ kind: "content", id: here.id }, { kind: "lesson", id: lesson.id }, 400);
  await fails({ kind: "content", id: here.id }, { kind: "module", id: mod.id }, 403, { id: "someone-else", role: "INSTRUCTOR" });

  // The course's own instructor may.
  await contentService.swapSequenceOrder({ kind: "content", id: there.id }, { kind: "lesson", id: lesson.id }, { id: "teacher", role: "INSTRUCTOR" });
});

test("Content type and Quiz/Assignment link must agree", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });

  assert.throws(() => validateContentDataInvariants("QUIZ", null, null), /quizId/);
  assert.throws(() => validateContentDataInvariants("QUIZ", "q1", "a1"), /assignmentId/);
  assert.throws(() => validateContentDataInvariants("ASSIGNMENT", null, null), /assignmentId/);
  assert.throws(() => validateContentDataInvariants("VIDEO", "q1", null), /cannot have/);
  assert.doesNotThrow(() => validateContentDataInvariants("TEXT", null, null));

  await assert.rejects(() => contentService.createContent({ moduleId: mod.id, type: "QUIZ" }), (e) => e.statusCode === 400);
  await assert.rejects(() => contentService.createContent({ moduleId: mod.id, type: "VIDEO", quizId: "q1" }), (e) => e.statusCode === 400);

  // An assignment block without an Assignment creates one, in the same transaction.
  const block = await contentService.createContent({ moduleId: mod.id, type: "ASSIGNMENT", title: "Write it up", htmlContent: "Brief" });
  assert.ok(block.assignmentId);
  assert.strictEqual(db.tables.assignment.find((a) => a.id === block.assignmentId).description, "Brief");
});

test("standalone quizzes are never sequence items", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });

  await quiz({ moduleId: mod.id, lessonId: lesson.id }, "Skip test", { quizTag: "QUALIFYING" });
  await quiz({ moduleId: mod.id }, "Block quiz", { inSequence: false });
  await quiz({ moduleId: mod.id, lessonId: lesson.id }, "Real quiz");

  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), ["QUIZ:Real quiz@1"]);
  assert.deepStrictEqual(db.sequenceOf("moduleId", mod.id), ["LESSON:L1@1"]);
});

test("the player walks the same order: Prev/Next over the course example", () => {
  const item = (contentId, kind, type, order, title) => ({ contentId, kind, type, order, title, completed: false, visited: false });
  const node = (id, title, order, items, children = {}) => ({ id, title, order, items, ...children });
  const hierarchy = node("C", "Java Programming", null, [
    item("v", "CONTENT", "VIDEO", 1, "Welcome video"),
    item("img", "CONTENT", "IMAGE", 3, "Course map image"),
    item("q", "QUIZ", "QUIZ", 4, "Course Quiz"),
    item("a", "ASSIGNMENT", "ASSIGNMENT", 5, "Course Assignment"),
  ], {
    modules: [
      node("m1", "Introduction to Java", 2, [item("m1c", "CONTENT", "TEXT", 1, "Intro text")], { lessons: [] }),
      node("m2", "Variables", 6, [item("m2c", "CONTENT", "TEXT", 1, "Variables text")], { lessons: [] }),
    ],
  });

  const { steps, tree } = buildLearningSequence(hierarchy);
  assert.deepStrictEqual(
    steps.map((step) => step.title),
    ["Welcome video", "Intro text", "Course map image", "Course Quiz", "Course Assignment", "Variables text"]
  );
  // The Course Map draws the same order.
  assert.deepStrictEqual(
    tree.entries.map((entry) => (entry.type === "step" ? steps[entry.stepIndex].title : entry.node.title)),
    ["Welcome video", "Introduction to Java", "Course map image", "Course Quiz", "Course Assignment", "Variables"]
  );
  // Linear locks: only the first step is open for a new student.
  assert.deepStrictEqual(steps.map((step) => step.locked), [false, true, true, true, true, true]);
});
