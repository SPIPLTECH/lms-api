const test = require("node:test");
const assert = require("node:assert");

const prisma = require("../src/config/database");
const orderUtil = require("../src/modules/contents/contentOrder.util");
const contentService = require("../src/modules/contents/content.service");
const quizService = require("../src/modules/quizzes/quiz.service");
const assignmentService = require("../src/modules/assignments/assignment.service");
const moduleService = require("../src/modules/modules/module.service");
const lessonService = require("../src/modules/lessons/lesson.service");
const topicService = require("../src/modules/topics/topic.service");
const subTopicService = require("../src/modules/subTopic/subTopic.service");
const conceptService = require("../src/modules/concept/concept.service");
const { planParentSequence } = require("../scripts/backfillCommonOrder");
const { createSequenceDb } = require("./sequence-db.fake");

/**
 * ONE common sequence per parent: Content, Quiz, Assignment and the parent's
 * child entity all share a single `order` sequence, in the order they were
 * added, independently at every hierarchy level. Runs the real services
 * against an in-memory database (test/sequence-db.fake.js) — no DB writes.
 */

const COURSE = "course1";
const MODULE = "module1";
const LESSON = "lesson1";
const TOPIC = "topic1";
const SUBTOPIC = "subtopic1";
const CONCEPT = "concept1";

// Points the services' prisma singleton at a fresh in-memory database, plus
// the parent lookups they make outside the sequence transaction.
function useSequenceDb(t) {
  const db = createSequenceDb();
  const patched = [];
  const patch = (target, key, value) => {
    patched.push([target, key, target[key]]);
    target[key] = value;
  };

  const draftCourse = { status: "DRAFT", title: "Course" };
  const moduleRow = { id: MODULE, courseId: COURSE, course: draftCourse };
  const lessonRow = { id: LESSON, moduleId: MODULE, module: moduleRow };
  const topicRow = { id: TOPIC, lessonId: LESSON, lesson: lessonRow };
  const subTopicRow = { id: SUBTOPIC, topicId: TOPIC, topic: topicRow };
  const conceptRow = { id: CONCEPT, subTopicId: SUBTOPIC, subTopic: subTopicRow };
  // A lookup returns the fixture parent unless the in-memory table holds a
  // real row with that id (deletes look up the row they remove).
  const lookup = (name, fixture) => async (args) =>
    (await db[name].findUnique(args)) || { ...fixture, id: args.where.id };

  patch(prisma, "$transaction", db.$transaction);
  // The Course-level reorder guard reads the course's items through prisma,
  // and the two-phase reorders write through it.
  for (const delegate of ["content", "quiz", "assignment", "module"]) {
    patch(prisma[delegate], "findMany", db[delegate].findMany);
    patch(prisma[delegate], "update", db[delegate].update);
  }
  patch(prisma.course, "findUnique", async () => draftCourse);
  patch(prisma.module, "findUnique", lookup("module", moduleRow));
  patch(prisma.lesson, "findUnique", lookup("lesson", lessonRow));
  patch(prisma.topic, "findUnique", lookup("topic", topicRow));
  patch(prisma.subTopic, "findUnique", lookup("subTopic", subTopicRow));
  patch(prisma.concept, "findUnique", lookup("concept", conceptRow));
  patch(prisma.content, "findUnique", db.content.findUnique);
  patch(prisma.quiz, "findUnique", db.quiz.findUnique);
  patch(prisma.assignment, "findUnique", db.assignment.findUnique);

  t.after(() => {
    for (const [target, key, original] of patched.reverse()) target[key] = original;
  });
  return db;
}

const content = (parent, title) => contentService.createContent({ ...parent, type: "TEXT", title });
const quiz = (parent, title) =>
  quizService.createQuiz({ courseId: COURSE, ...parent, title, passingScore: 70, quizTag: "FINAL", isPublished: false });
const assignment = (parent, title) =>
  assignmentService.createAssignment({ ...parent, title, dueDate: "2026-10-01T00:00:00.000Z" });

test("the Module example: every type continues one sequence in the order it was added", async (t) => {
  const db = useSequenceDb(t);
  const inModule = { moduleId: MODULE };

  await content(inModule, "Content-1");
  await content(inModule, "Content-2");
  assert.deepStrictEqual(db.sequenceOf("moduleId", MODULE), ["content:Content-1@1", "content:Content-2@2"]);

  await quiz(inModule, "Quiz-1");
  assert.deepStrictEqual(db.sequenceOf("moduleId", MODULE), [
    "content:Content-1@1",
    "content:Content-2@2",
    "quiz:Quiz-1@3",
  ]);

  await content(inModule, "Content-3");
  await content(inModule, "Content-4");
  await quiz(inModule, "Quiz-2");
  await assignment(inModule, "Assignment-1");
  await lessonService.createLesson({ moduleId: MODULE, title: "Lesson-1", isPublished: false });
  await lessonService.createLesson({ moduleId: MODULE, title: "Lesson-2", isPublished: false });
  await content(inModule, "Content-5");
  await quiz(inModule, "Quiz-3");

  assert.deepStrictEqual(db.sequenceOf("moduleId", MODULE), [
    "content:Content-1@1",
    "content:Content-2@2",
    "quiz:Quiz-1@3",
    "content:Content-3@4",
    "content:Content-4@5",
    "quiz:Quiz-2@6",
    "assignment:Assignment-1@7",
    "lesson:Lesson-1@8",
    "lesson:Lesson-2@9",
    "content:Content-5@10",
    "quiz:Quiz-3@11",
  ]);
});

test("the same rule applies independently at every level", async (t) => {
  const db = useSequenceDb(t);

  // Course: its own CQA + Modules
  await content({ courseId: COURSE }, "C-content");
  await moduleService.createModule({ courseId: COURSE, title: "Module-A", isPublished: false });
  await quiz({}, "C-quiz");
  await assignment({ courseId: COURSE }, "C-assignment");
  await moduleService.createModule({ courseId: COURSE, title: "Module-B", isPublished: false });

  // Lesson: its own CQA + Topics
  await topicService.createTopic({ lessonId: LESSON, title: "Topic-A", isPublished: false });
  await content({ lessonId: LESSON }, "L-content");
  await quiz({ moduleId: MODULE, lessonId: LESSON }, "L-quiz");

  // Topic: its own CQA + SubTopics
  await quiz({ moduleId: MODULE, lessonId: LESSON, topicId: TOPIC }, "T-quiz");
  await subTopicService.createSubTopic({ topicId: TOPIC, title: "SubTopic-A", isPublished: false });
  await assignment({ topicId: TOPIC }, "T-assignment");

  // SubTopic: its own CQA + Concepts
  await conceptService.createConcept({ subTopicId: SUBTOPIC, title: "Concept-A", isPublished: false });
  await content({ subTopicId: SUBTOPIC }, "S-content");

  // Concept: its own CQA only
  await assignment({ conceptId: CONCEPT }, "K-assignment");
  await content({ conceptId: CONCEPT }, "K-content");
  await quiz({ moduleId: MODULE, lessonId: LESSON, topicId: TOPIC, subTopicId: SUBTOPIC, conceptId: CONCEPT }, "K-quiz");

  // Course level is the one exception: it is grouped Content -> Modules ->
  // Assignments -> Quizzes whatever order things were added in (see the
  // "course level" tests below).
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "content:C-content@1",
    "module:Module-A@2",
    "module:Module-B@3",
    "assignment:C-assignment@4",
    "quiz:C-quiz@5",
  ]);
  assert.deepStrictEqual(db.sequenceOf("lessonId", LESSON), ["topic:Topic-A@1", "content:L-content@2", "quiz:L-quiz@3"]);
  assert.deepStrictEqual(db.sequenceOf("topicId", TOPIC), [
    "quiz:T-quiz@1",
    "subTopic:SubTopic-A@2",
    "assignment:T-assignment@3",
  ]);
  assert.deepStrictEqual(db.sequenceOf("subTopicId", SUBTOPIC), ["concept:Concept-A@1", "content:S-content@2"]);
  assert.deepStrictEqual(db.sequenceOf("conceptId", CONCEPT), [
    "assignment:K-assignment@1",
    "content:K-content@2",
    "quiz:K-quiz@3",
  ]);

  // Quizzes carrying ancestor ids only took a slot in their own parent's
  // sequence: the Module above still holds nothing.
  assert.deepStrictEqual(db.sequenceOf("moduleId", MODULE), []);
});

test("inserting at a position moves every later item of any type down one", async (t) => {
  const db = useSequenceDb(t);
  const inTopic = { topicId: TOPIC };

  await content(inTopic, "A");
  await quiz({ moduleId: MODULE, lessonId: LESSON, topicId: TOPIC }, "B");
  await subTopicService.createSubTopic({ topicId: TOPIC, title: "C", isPublished: false });

  await contentService.createContent({ ...inTopic, type: "TEXT", title: "Inserted", order: 2 });
  assert.deepStrictEqual(db.sequenceOf("topicId", TOPIC), [
    "content:A@1",
    "content:Inserted@2",
    "quiz:B@3",
    "subTopic:C@4",
  ]);

  await quizService.createQuiz({
    courseId: COURSE, moduleId: MODULE, lessonId: LESSON, topicId: TOPIC,
    title: "Quiz-at-1", passingScore: 70, quizTag: "FINAL", isPublished: false, order: 1,
  });
  assert.deepStrictEqual(db.sequenceOf("topicId", TOPIC), [
    "quiz:Quiz-at-1@1",
    "content:A@2",
    "content:Inserted@3",
    "quiz:B@4",
    "subTopic:C@5",
  ]);

  // Past the end is an append, never a gap.
  await subTopicService.createSubTopic({ topicId: TOPIC, title: "Far", order: 99, isPublished: false });
  assert.deepStrictEqual(db.sequenceOf("topicId", TOPIC).at(-1), "subTopic:Far@6");
});

test("order 0 is a valid position", async (t) => {
  const db = useSequenceDb(t);
  const inLesson = { lessonId: LESSON };

  await content(inLesson, "First");
  await content(inLesson, "Second");

  // In front of a sequence that starts at 1: takes 0, nothing else moves.
  await contentService.createContent({ ...inLesson, type: "TEXT", title: "Zero", order: 0 });
  assert.deepStrictEqual(db.sequenceOf("lessonId", LESSON), ["content:Zero@0", "content:First@1", "content:Second@2"]);

  // At 0 again once 0 is taken: inserted there, the rest move down.
  await topicService.createTopic({ lessonId: LESSON, title: "New-zero", order: 0, isPublished: false });
  assert.deepStrictEqual(db.sequenceOf("lessonId", LESSON), [
    "topic:New-zero@0",
    "content:Zero@1",
    "content:First@2",
    "content:Second@3",
  ]);

  // Appends still continue after the last item.
  await content(inLesson, "Last");
  assert.deepStrictEqual(db.sequenceOf("lessonId", LESSON).at(-1), "content:Last@4");
});

test("removing an item closes its slot across every type", async (t) => {
  const db = useSequenceDb(t);
  const inModule = { moduleId: MODULE };

  await content(inModule, "C1");
  const q1 = await quiz(inModule, "Q1");
  await assignment(inModule, "A1");
  const c2 = await content(inModule, "C2");
  const a2 = await assignment(inModule, "A2");
  await lessonService.createLesson({ moduleId: MODULE, title: "L1", isPublished: false });

  await quizService.deleteQuiz(q1.id);
  assert.deepStrictEqual(db.sequenceOf("moduleId", MODULE), [
    "content:C1@1",
    "assignment:A1@2",
    "content:C2@3",
    "assignment:A2@4",
    "lesson:L1@5",
  ]);

  await contentService.deleteContent(c2.id);
  await assignmentService.deleteAssignment(a2.id);
  assert.deepStrictEqual(db.sequenceOf("moduleId", MODULE), ["content:C1@1", "assignment:A1@2", "lesson:L1@3"]);

  // The next add continues right after the last remaining item.
  await quiz(inModule, "Q2");
  assert.deepStrictEqual(db.sequenceOf("moduleId", MODULE).at(-1), "quiz:Q2@4");
});

test("removing a hierarchy entity closes its slot in its parent's sequence", async (t) => {
  const db = useSequenceDb(t);

  await content({ subTopicId: SUBTOPIC }, "S1");
  const concept = await conceptService.createConcept({ subTopicId: SUBTOPIC, title: "K1", isPublished: false });
  await quiz({ subTopicId: SUBTOPIC }, "S-quiz");

  await conceptService.deleteConcept(concept.id);
  assert.deepStrictEqual(db.sequenceOf("subTopicId", SUBTOPIC), ["content:S1@1", "quiz:S-quiz@2"]);
});

test("every sequence change holds the parent's lock", async (t) => {
  const db = useSequenceDb(t);
  await content({ moduleId: MODULE }, "C1");
  await lessonService.createLesson({ moduleId: MODULE, title: "L1", isPublished: false });
  assert.deepStrictEqual(db.locks, [`sequence:moduleId:${MODULE}`, `sequence:moduleId:${MODULE}`]);
});

// ---------------------------------------------------------------------------
// COURSE LEVEL ONLY: every Course Quiz sits after every other Course item.
// The order among Content, Assignment and Module is not constrained.
// ---------------------------------------------------------------------------

test("course level: the sequence is Content -> Modules -> Assignments -> Quizzes", async (t) => {
  const db = useSequenceDb(t);

  // Added in a deliberately scrambled order: every item still lands in its
  // own group, and keeps its place among its own kind.
  await quiz({}, "Quiz-1");
  await assignment({ courseId: COURSE }, "Assignment-1");
  await moduleService.createModule({ courseId: COURSE, title: "Module-1", isPublished: false });
  await content({ courseId: COURSE }, "Content-1");
  await moduleService.createModule({ courseId: COURSE, title: "Module-2", isPublished: false });
  await assignment({ courseId: COURSE }, "Assignment-2");
  await content({ courseId: COURSE }, "Content-2");
  await quiz({}, "Quiz-2");

  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "content:Content-1@1",
    "content:Content-2@2",
    "module:Module-1@3",
    "module:Module-2@4",
    "assignment:Assignment-1@5",
    "assignment:Assignment-2@6",
    "quiz:Quiz-1@7",
    "quiz:Quiz-2@8",
  ]);
});

test("course level: a Module added after Assignments and Quizzes joins the Module group", async (t) => {
  const db = useSequenceDb(t);

  await content({ courseId: COURSE }, "Content-1");
  await moduleService.createModule({ courseId: COURSE, title: "Module-1", isPublished: false });
  await moduleService.createModule({ courseId: COURSE, title: "Module-2", isPublished: false });
  await assignment({ courseId: COURSE }, "Assignment-1");
  await quiz({}, "Quiz-1");

  await moduleService.createModule({ courseId: COURSE, title: "Module-3", isPublished: false });
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "content:Content-1@1",
    "module:Module-1@2",
    "module:Module-2@3",
    "module:Module-3@4",
    "assignment:Assignment-1@5",
    "quiz:Quiz-1@6",
  ]);

  // A second Assignment goes after every Module and before every Quiz.
  await assignment({ courseId: COURSE }, "Assignment-2");
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "content:Content-1@1",
    "module:Module-1@2",
    "module:Module-2@3",
    "module:Module-3@4",
    "assignment:Assignment-1@5",
    "assignment:Assignment-2@6",
    "quiz:Quiz-1@7",
  ]);

  // A second Quiz closes the sequence, after the Assignments.
  await quiz({}, "Quiz-2");
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE).slice(-2), ["quiz:Quiz-1@7", "quiz:Quiz-2@8"]);
});

test("course level: a requested position cannot cross a group boundary", async (t) => {
  const db = useSequenceDb(t);

  await content({ courseId: COURSE }, "Content-1");
  await moduleService.createModule({ courseId: COURSE, title: "Module-1", isPublished: false });
  await moduleService.createModule({ courseId: COURSE, title: "Module-2", isPublished: false });

  // "Add quiz here", asking for the slot between the two Modules.
  await quizService.createQuiz({
    courseId: COURSE, title: "Quiz-1", passingScore: 70, quizTag: "FINAL", isPublished: false, order: 3,
  });
  // "Add assignment here", asking for the slot in front of Module-1.
  await assignmentService.createAssignment({
    courseId: COURSE, title: "Assignment-1", dueDate: "2026-10-01T00:00:00.000Z", order: 2,
  });
  // Course content asking for the very end still stays in the Content group.
  await contentService.createContent({ courseId: COURSE, type: "TEXT", title: "Content-2", order: 99 });

  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "content:Content-1@1",
    "content:Content-2@2",
    "module:Module-1@3",
    "module:Module-2@4",
    "assignment:Assignment-1@5",
    "quiz:Quiz-1@6",
  ]);
});

test("course level: Content added while a Quiz exists still lands in the Content group", async (t) => {
  const db = useSequenceDb(t);

  await content({ courseId: COURSE }, "Content-1");
  await moduleService.createModule({ courseId: COURSE, title: "Module-1", isPublished: false });
  await quiz({}, "Quiz-1");

  await content({ courseId: COURSE }, "Content-2");
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "content:Content-1@1",
    "content:Content-2@2",
    "module:Module-1@3",
    "quiz:Quiz-1@4",
  ]);

  await assignment({ courseId: COURSE }, "Assignment-1");
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "content:Content-1@1",
    "content:Content-2@2",
    "module:Module-1@3",
    "assignment:Assignment-1@4",
    "quiz:Quiz-1@5",
  ]);
});

test("course level: deleting an item closes its slot and keeps the groups intact", async (t) => {
  const db = useSequenceDb(t);

  const c1 = await content({ courseId: COURSE }, "Content-1");
  const mod = await moduleService.createModule({ courseId: COURSE, title: "Module-1", isPublished: false });
  await moduleService.createModule({ courseId: COURSE, title: "Module-2", isPublished: false });
  const asgn = await assignment({ courseId: COURSE }, "Assignment-1");
  await quiz({}, "Quiz-1");
  await quiz({}, "Quiz-2");

  await contentService.deleteContent(c1.id);
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "module:Module-1@1",
    "module:Module-2@2",
    "assignment:Assignment-1@3",
    "quiz:Quiz-1@4",
    "quiz:Quiz-2@5",
  ]);

  await moduleService.deleteModule(mod.id);
  await assignmentService.deleteAssignment(asgn.id);
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "module:Module-2@1",
    "quiz:Quiz-1@2",
    "quiz:Quiz-2@3",
  ]);

  // The next Module still lands in front of the Quizzes.
  await moduleService.createModule({ courseId: COURSE, title: "Module-3", isPublished: false });
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "module:Module-2@1",
    "module:Module-3@2",
    "quiz:Quiz-1@3",
    "quiz:Quiz-2@4",
  ]);
});

test("course level: a reorder may not move an item out of its group", async (t) => {
  const db = useSequenceDb(t);

  const content1 = await content({ courseId: COURSE }, "Content-1");
  const module1 = await moduleService.createModule({ courseId: COURSE, title: "Module-1", isPublished: false });
  const module2 = await moduleService.createModule({ courseId: COURSE, title: "Module-2", isPublished: false });
  const assignment1 = await assignment({ courseId: COURSE }, "Assignment-1");
  const quiz1 = await quiz({}, "Quiz-1");
  const before = db.sequenceOf("courseId", COURSE);
  assert.deepStrictEqual(before, [
    "content:Content-1@1",
    "module:Module-1@2",
    "module:Module-2@3",
    "assignment:Assignment-1@4",
    "quiz:Quiz-1@5",
  ]);

  const rejected = (promise) =>
    assert.rejects(promise, (error) => error.statusCode === 400 && /content, then modules, then assignments, then quizzes/.test(error.message));

  // A Module below the Assignment.
  await rejected(moduleService.reorderModules(COURSE, [{ id: module2.id, order: 4 }]));
  // The Assignment above a Module.
  await rejected(assignmentService.reorderAssignments([{ id: assignment1.id, order: 3 }]));
  // The Assignment below the Quiz.
  await rejected(assignmentService.reorderAssignments([{ id: assignment1.id, order: 5 }]));
  // The Quiz in front of the Assignment.
  await rejected(quizService.reorderQuizzes([{ id: quiz1.id, order: 4 }]));
  // Course Content after a Module.
  await rejected(contentService.reorderContents([{ id: content1.id, order: 2 }]));

  // Every rejection happened before anything was written.
  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), before);
});

test("course level: reordering inside a group is still allowed", async (t) => {
  const db = useSequenceDb(t);

  await content({ courseId: COURSE }, "Content-1");
  const module1 = await moduleService.createModule({ courseId: COURSE, title: "Module-1", isPublished: false });
  const module2 = await moduleService.createModule({ courseId: COURSE, title: "Module-2", isPublished: false });
  const quiz1 = await quiz({}, "Quiz-1");
  const quiz2 = await quiz({}, "Quiz-2");

  await moduleService.reorderModules(COURSE, [
    { id: module1.id, order: 3 },
    { id: module2.id, order: 2 },
  ]);
  await quizService.reorderQuizzes([
    { id: quiz1.id, order: 5 },
    { id: quiz2.id, order: 4 },
  ]);

  assert.deepStrictEqual(db.sequenceOf("courseId", COURSE), [
    "content:Content-1@1",
    "module:Module-2@2",
    "module:Module-1@3",
    "quiz:Quiz-2@4",
    "quiz:Quiz-1@5",
  ]);
});

test("lower levels are unaffected: a Module-level Quiz still takes its insertion slot", async (t) => {
  const db = useSequenceDb(t);

  await content({ moduleId: MODULE }, "M-content-1");
  await quiz({ moduleId: MODULE }, "M-quiz");
  await lessonService.createLesson({ moduleId: MODULE, title: "M-lesson", isPublished: false });
  await content({ moduleId: MODULE }, "M-content-2");

  // The Quiz stays where it was added — the Course rule does not reach here.
  assert.deepStrictEqual(db.sequenceOf("moduleId", MODULE), [
    "content:M-content-1@1",
    "quiz:M-quiz@2",
    "lesson:M-lesson@3",
    "content:M-content-2@4",
  ]);

  // And a Module-level reorder may put that Quiz first.
  await quizService.reorderQuizzes([{ id: db.tables.quiz[0].id, order: 0 }]);
  assert.strictEqual(db.tables.quiz[0].order, 0);
});

test("sequenceMembers: a parent's sequence spans Content, Quiz, Assignment and its child entity", () => {
  const kinds = (field) => orderUtil.sequenceMembers(field, "p").map((m) => m.kind);
  assert.deepStrictEqual(kinds("courseId"), ["content", "quiz", "assignment", "module"]);
  assert.deepStrictEqual(kinds("moduleId"), ["content", "quiz", "assignment", "lesson"]);
  assert.deepStrictEqual(kinds("lessonId"), ["content", "quiz", "assignment", "topic"]);
  assert.deepStrictEqual(kinds("topicId"), ["content", "quiz", "assignment", "subTopic"]);
  assert.deepStrictEqual(kinds("subTopicId"), ["content", "quiz", "assignment", "concept"]);
  assert.deepStrictEqual(kinds("conceptId"), ["content", "quiz", "assignment"]);

  // CQA rows belong to their most specific parent only.
  const topicQuizWhere = orderUtil.sequenceMembers("topicId", "t").find((m) => m.kind === "quiz").where;
  assert.deepStrictEqual(topicQuizWhere, { topicId: "t", subTopicId: null, conceptId: null });
});

test("backfill plan: legacy per-type counters and bands become one insertion-ordered sequence", () => {
  const at = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute));
  // Legacy Module: Content 1..3, Lessons 1..2, Quiz in the old 1,000,001 band,
  // Assignment in the 2,000,001 band.
  const plan = planParentSequence([
    { kind: "content", id: "C1", order: 1, createdAt: at(1) },
    { kind: "content", id: "C2", order: 2, createdAt: at(2) },
    { kind: "quiz", id: "Q1", order: 1_000_001, createdAt: at(3) },
    { kind: "assignment", id: "A1", order: 2_000_001, createdAt: at(4) },
    { kind: "lesson", id: "L1", order: 1, createdAt: at(5) },
    { kind: "lesson", id: "L2", order: 2, createdAt: at(6) },
    { kind: "content", id: "C3", order: 3, createdAt: at(7) },
  ]);
  assert.deepStrictEqual(
    plan.map((p) => `${p.id}@${p.newOrder}`),
    ["C1@1", "C2@2", "Q1@3", "A1@4", "L1@5", "L2@6", "C3@7"]
  );
});

test("backfill plan: a type's own manual order is kept when rebuilding", () => {
  const at = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute));
  // C3 was inserted above C2 later (it sits before C2 in Content's own order).
  const plan = planParentSequence([
    { kind: "content", id: "C1", order: 1, createdAt: at(1) },
    { kind: "content", id: "C3", order: 2, createdAt: at(9) },
    { kind: "content", id: "C2", order: 3, createdAt: at(2) },
    { kind: "quiz", id: "Q1", order: 1_000_001, createdAt: at(3) },
  ]);
  assert.deepStrictEqual(plan.map((p) => p.id), ["C1", "C3", "C2", "Q1"]);
});

test("backfill plan: a legacy course becomes Content -> Modules -> Assignments -> Quizzes, idempotently", () => {
  const at = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute));
  // Legacy course, in the order the items were added:
  // Content-1 → Module-1 → Quiz-1 → Module-2 → Assignment-1 → Content-2 → Quiz-2
  const items = [
    { kind: "content", id: "Content-1", order: 1, createdAt: at(1) },
    { kind: "module", id: "Module-1", order: 1, createdAt: at(2) },
    { kind: "quiz", id: "Quiz-1", order: 1_000_001, createdAt: at(3) },
    { kind: "module", id: "Module-2", order: 2, createdAt: at(4) },
    { kind: "assignment", id: "Assignment-1", order: 2_000_001, createdAt: at(5) },
    { kind: "content", id: "Content-2", order: 2, createdAt: at(6) },
    { kind: "quiz", id: "Quiz-2", order: 1_000_002, createdAt: at(7) },
  ];
  const expected = [
    "Content-1@1",
    "Content-2@2",
    "Module-1@3",
    "Module-2@4",
    "Assignment-1@5",
    "Quiz-1@6",
    "Quiz-2@7",
  ];

  const plan = planParentSequence(items, "courseId");
  assert.deepStrictEqual(plan.map((p) => `${p.id}@${p.newOrder}`), expected);

  // Running it again over the result changes nothing.
  const rerun = planParentSequence(
    plan.map(({ kind, id, newOrder, createdAt }) => ({ kind, id, order: newOrder, createdAt })),
    "courseId"
  );
  assert.deepStrictEqual(rerun.map((p) => `${p.id}@${p.newOrder}`), expected);
});

test("backfill plan: lower levels are not partitioned by type", () => {
  const at = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute));
  const items = [
    { kind: "content", id: "C1", order: 1, createdAt: at(1) },
    { kind: "quiz", id: "Q1", order: 2, createdAt: at(2) },
    { kind: "lesson", id: "L1", order: 3, createdAt: at(3) },
  ];
  // Module level keeps the quiz where it is.
  assert.deepStrictEqual(planParentSequence(items, "moduleId").map((p) => p.id), ["C1", "Q1", "L1"]);
});

test("backfill plan: a parent already on one sequence keeps its order and is compacted", () => {
  const at = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute));
  const plan = planParentSequence([
    { kind: "quiz", id: "Q", order: 1, createdAt: at(9) },
    { kind: "content", id: "C", order: 3, createdAt: at(1) },
    { kind: "topic", id: "T", order: 7, createdAt: at(2) },
  ]);
  assert.deepStrictEqual(plan.map((p) => `${p.id}@${p.newOrder}`), ["Q@1", "C@2", "T@3"]);
});
