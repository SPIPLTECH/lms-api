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

// --- Move Up / Move Down -----------------------------------------------------
// The Course Map moves any row — Content, placed quiz, assignment or child
// container — by swapping it with its neighbour in the parent's ONE sequence
// and sending the parent's complete new order ({ parentType, parentId,
// orderedIds }). These pin that contract at every level.

const TEACHER = { id: "teacher", role: "INSTRUCTOR" };
const wrapperOf = (db, link) => db.tables.content.find((row) => row[`${link.kind}Id`] === link.id).id;
const moveTo = (parentType, parentId, orderedIds) =>
  contentService.reorderContents({ parentType, parentId, orderedIds }, TEACHER);

test("Move Up: the recording's Topic moves one slot past the Image above it, and the order persists on refetch", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "Java Basics" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "Getting Started" });
  const dataTypes = await topicService.createTopic({ lessonId: lesson.id, title: "Data Types" });
  const variables = await topicService.createTopic({ lessonId: lesson.id, title: "Variables" });
  const sampleAssignment = await assignment({ lessonId: lesson.id }, "Sample Assignment");
  const basicsQuiz = await quiz({ moduleId: mod.id, lessonId: lesson.id }, "Java Basics");
  const image = await content({ lessonId: lesson.id }, "IMAGE", "Image");
  const sample = await topicService.createTopic({ lessonId: lesson.id, title: "Sample Topic" });
  const hello = await video({ lessonId: lesson.id }, "Hello Java");
  const asgRow = wrapperOf(db, { kind: "assignment", id: sampleAssignment.id });
  const quizRow = wrapperOf(db, { kind: "quiz", id: basicsQuiz.id });

  await moveTo("lesson", lesson.id, [dataTypes.id, variables.id, asgRow, quizRow, sample.id, image.id, hello.id]);
  const expected = [
    "TOPIC:Data Types@1",
    "TOPIC:Variables@2",
    "ASSIGNMENT:Sample Assignment@3",
    "QUIZ:Java Basics@4",
    "TOPIC:Sample Topic@5",
    "IMAGE:Image@6",
    "VIDEO:Hello Java@7",
  ];
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), expected);

  // Fetch both halves again, the way the Course Map loads them, and interleave.
  const contents = await contentService.getContents({ lessonId: lesson.id }, "INSTRUCTOR", "teacher");
  const topics = await topicService.getTopics(lesson.id, "INSTRUCTOR", "teacher");
  const refetched = [
    ...contents.map((row) => ({ label: `${row.type}:${row.title}`, order: row.order })),
    ...topics.map((row) => ({ label: `TOPIC:${row.title}`, order: row.order })),
  ].sort((a, b) => a.order - b.order);
  assert.deepStrictEqual(refetched.map((row) => `${row.label}@${row.order}`), expected);

  // ...and Move Down puts it back below the Image, Video untouched.
  await moveTo("lesson", lesson.id, [dataTypes.id, variables.id, asgRow, quizRow, image.id, sample.id, hello.id]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id).slice(4), ["IMAGE:Image@5", "TOPIC:Sample Topic@6", "VIDEO:Hello Java@7"]);
  await moveTo("lesson", lesson.id, [dataTypes.id, variables.id, asgRow, quizRow, image.id, hello.id, sample.id]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id).slice(4), ["IMAGE:Image@5", "VIDEO:Hello Java@6", "TOPIC:Sample Topic@7"]);
});

test("Move Up/Down swaps every sibling kind with adjacent Content, at every level", async (t) => {
  const db = useSequenceDb(t);
  // Course: Content <-> Module
  const welcome = await video({ courseId: COURSE }, "Welcome");
  const m1 = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const courseImage = await content({ courseId: COURSE }, "IMAGE", "Course map");
  const m2 = await moduleService.createModule({ courseId: COURSE, title: "M2" });
  await moveTo("course", COURSE, [welcome.id, courseImage.id, m1.id, m2.id]);
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), ["VIDEO:Welcome@1", "IMAGE:Course map@2", "MODULE:M1@3", "MODULE:M2@4"]);

  // Module: Content <-> Lesson
  const l1 = await lessonService.createLesson({ moduleId: m1.id, title: "L1" });
  const intro = await content({ moduleId: m1.id }, "PDF", "Module intro");
  const l2 = await lessonService.createLesson({ moduleId: m1.id, title: "L2" });
  await moveTo("module", m1.id, [l1.id, l2.id, intro.id]);
  assert.deepStrictEqual(db.sequenceOf("moduleId", m1.id), ["LESSON:L1@1", "LESSON:L2@2", "PDF:Module intro@3"]);

  // Lesson: placed Quiz <-> Content, Assignment <-> Content
  const lessonImage = await content({ lessonId: l1.id }, "IMAGE", "Lesson image");
  const checkQuiz = await quiz({ moduleId: m1.id, lessonId: l1.id }, "Check");
  const task = await assignment({ lessonId: l1.id }, "Task");
  const lessonVideo = await video({ lessonId: l1.id }, "Lesson video");
  const checkRow = wrapperOf(db, { kind: "quiz", id: checkQuiz.id });
  const taskRow = wrapperOf(db, { kind: "assignment", id: task.id });
  await moveTo("lesson", l1.id, [checkRow, lessonImage.id, taskRow, lessonVideo.id]);
  await moveTo("lesson", l1.id, [checkRow, lessonImage.id, lessonVideo.id, taskRow]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", l1.id), ["QUIZ:Check@1", "IMAGE:Lesson image@2", "VIDEO:Lesson video@3", "ASSIGNMENT:Task@4"]);

  // Topic: Content <-> SubTopic
  const topic = await topicService.createTopic({ lessonId: l1.id, title: "T1" });
  const topicText = await content({ topicId: topic.id }, "TEXT", "Topic text");
  const s1 = await subTopicService.createSubTopic({ topicId: topic.id, title: "S1" });
  await moveTo("topic", topic.id, [s1.id, topicText.id]);
  assert.deepStrictEqual(db.sequenceOf("topicId", topic.id), ["SUBTOPIC:S1@1", "TEXT:Topic text@2"]);

  // SubTopic: Content <-> Concept
  const c1 = await conceptService.createConcept({ subTopicId: s1.id, title: "C1" });
  const subVideo = await video({ subTopicId: s1.id }, "SubTopic video");
  await moveTo("subTopic", s1.id, [subVideo.id, c1.id]);
  assert.deepStrictEqual(db.sequenceOf("subTopicId", s1.id), ["VIDEO:SubTopic video@1", "CONCEPT:C1@2"]);

  // Concept: its own Content only
  const conceptVideo = await video({ conceptId: c1.id }, "Video");
  const conceptPdf = await content({ conceptId: c1.id }, "PDF", "PDF");
  await moveTo("concept", c1.id, [conceptPdf.id, conceptVideo.id]);
  assert.deepStrictEqual(db.sequenceOf("conceptId", c1.id), ["PDF:PDF@1", "VIDEO:Video@2"]);

  // Moving a container never touched any other parent's sequence.
  assert.deepStrictEqual(db.sequenceOf("lessonId", l2.id), []);
  assert.deepStrictEqual(db.sequenceOf("moduleId", m2.id), []);
  assert.deepStrictEqual(db.sequenceOf("lessonId", l1.id).length, 5, "the lesson holds its four items and Topic T1");
});

test("a full new order must list exactly the parent's own items", async (t) => {
  const db = useSequenceDb(t);
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  const other = await lessonService.createLesson({ moduleId: mod.id, title: "L2" });
  const intro = await video({ lessonId: lesson.id }, "Intro");
  const t1 = await topicService.createTopic({ lessonId: lesson.id, title: "T1" });
  const inside = await video({ topicId: t1.id }, "Inside T1");
  const elsewhere = await topicService.createTopic({ lessonId: other.id, title: "Elsewhere" });
  const before = db.sequenceOf("lessonId", lesson.id);

  const fails = (orderedIds, status = 400, user = TEACHER) =>
    assert.rejects(
      () => contentService.reorderContents({ parentType: "lesson", parentId: lesson.id, orderedIds }, user),
      (error) => error.statusCode === status
    );
  await fails([t1.id], 400); // incomplete
  await fails([t1.id, t1.id], 400); // duplicated
  await fails([elsewhere.id, intro.id], 400); // a Topic of another Lesson
  await fails([inside.id, intro.id], 400); // Content one level down, inside the Topic
  await fails([t1.id, intro.id, "no-such-id"], 400); // unknown
  await fails([t1.id, intro.id], 403, { id: "someone-else", role: "INSTRUCTOR" });

  assert.deepStrictEqual(db.sequenceOf("lessonId", lesson.id), before, "a refused reorder changes nothing");
  assert.deepStrictEqual(db.sequenceOf("lessonId", other.id), ["TOPIC:Elsewhere@1"]);
});

// A duplicated course keeps every copied row's order but skips its QUIZ rows
// (course.service copyContentSequence), so a parent can hold A@1 Y@2 X@4 B@5.
// Every move payload reads `order` the way the client sees it — as stored —
// so a gap must never make an item skip a neighbour.
async function gappedLesson() {
  const mod = await moduleService.createModule({ courseId: COURSE, title: "M1" });
  const lesson = await lessonService.createLesson({ moduleId: mod.id, title: "L1" });
  const a = await video({ lessonId: lesson.id }, "A");
  const y = await topicService.createTopic({ lessonId: lesson.id, title: "Y" });
  const x = await content({ lessonId: lesson.id }, "IMAGE", "X");
  const b = await video({ lessonId: lesson.id }, "B");
  return { lesson, a, y, x, b };
}
function leaveGapAfterY(db, { x, b }) {
  db.tables.content.find((row) => row.id === b.id).order = 5;
  db.tables.content.find((row) => row.id === x.id).order = 4;
}

test("across a gap in stored orders, a { contents } swap moves exactly one slot", async (t) => {
  const db = useSequenceDb(t);
  const s = await gappedLesson();
  leaveGapAfterY(db, s);
  assert.deepStrictEqual(db.sequenceOf("lessonId", s.lesson.id), ["VIDEO:A@1", "TOPIC:Y@2", "IMAGE:X@4", "VIDEO:B@5"]);

  // What a client reading stored orders sends for "X Move Up": X takes Y's order, Y takes X's.
  await contentService.reorderContents({ parentType: "lesson", parentId: s.lesson.id, contents: [{ id: s.x.id, order: 2 }, { id: s.y.id, order: 4 }] });
  assert.deepStrictEqual(db.sequenceOf("lessonId", s.lesson.id), ["VIDEO:A@1", "IMAGE:X@2", "TOPIC:Y@3", "VIDEO:B@4"]);
});

test("across a gap in stored orders, swap-order moves exactly one slot", async (t) => {
  const db = useSequenceDb(t);
  const s = await gappedLesson();
  leaveGapAfterY(db, s);

  await contentService.swapSequenceOrder({ kind: "content", id: s.x.id }, { kind: "topic", id: s.y.id });
  assert.deepStrictEqual(db.sequenceOf("lessonId", s.lesson.id), ["VIDEO:A@1", "IMAGE:X@2", "TOPIC:Y@3", "VIDEO:B@4"]);
});

test("across a gap in stored orders, a container reorder moves exactly one slot", async (t) => {
  const db = useSequenceDb(t);
  const s = await gappedLesson();
  leaveGapAfterY(db, s);

  // "Y Move Down": Y to the order X holds.
  await topicService.reorderTopics(s.lesson.id, [{ id: s.y.id, order: 4 }]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", s.lesson.id), ["VIDEO:A@1", "IMAGE:X@2", "TOPIC:Y@3", "VIDEO:B@4"]);
});

test("across a gap in stored orders, a full new order lands exactly as listed", async (t) => {
  const db = useSequenceDb(t);
  const s = await gappedLesson();
  leaveGapAfterY(db, s);

  await moveTo("lesson", s.lesson.id, [s.a.id, s.x.id, s.y.id, s.b.id]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", s.lesson.id), ["VIDEO:A@1", "IMAGE:X@2", "TOPIC:Y@3", "VIDEO:B@4"]);
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
