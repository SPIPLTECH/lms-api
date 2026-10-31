/**
 * The proctoring checkbox on a quiz: who may set it, the Self-Test and time-limit
 * rules, the lock once an attempt exists, and the question lock.
 * Real HTTP, disposable local database.
 */
const { describe, test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);

describe("proctoring checkbox", { skip: HAS_TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  const { createHarness } = require("./helpers/proctoringHarness");
  const h = createHarness("box");
  const { prisma, call } = h;
  let owner;
  let other;
  let admin;
  let student;
  let course;
  let lessonId;

  const baseQuiz = (extra = {}) => ({ title: "Exam", courseId: course.id, quizTag: "FINAL", passingScore: 50, timeLimit: 30, ...extra });

  const addAttempt = (quiz, status = "PREPARING") =>
    prisma.proctoredAttempt.create({
      data: { quizId: quiz.id, courseId: quiz.courseId, studentId: student.studentId, userId: student.id, status, policy: {}, durationMinutes: 30 },
    });

  before(async () => {
    await h.start();
    owner = await h.makeUser("INSTRUCTOR", "Owner");
    other = await h.makeUser("INSTRUCTOR", "Other");
    admin = await h.makeUser("ADMIN", "Admin");
    student = await h.makeUser("STUDENT", "Student");
    course = await h.makeCourse(owner.id);
    const module = await prisma.module.create({ data: { title: "M", order: 1, courseId: course.id, isPublished: true } });
    const lesson = await prisma.lesson.create({ data: { title: "L", order: 1, moduleId: module.id, isPublished: true } });
    lessonId = lesson.id;
    await h.enroll(course, student);
  });

  beforeEach(() => {
    process.env.PROCTORING_ENABLED = "true";
    delete process.env.PROCTORING_LIVE_ALLOWED;
  });

  after(() => h.stop());

  describe("setting it", () => {
    test("is off when not sent", async () => {
      const res = await call("POST", "/quizzes", owner, baseQuiz());
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.proctoringEnabled, false);
      assert.strictEqual(res.data.proctoringSetAt, null);
    });

    test("the owner can tick it on a timed Final, and who and when are recorded and audited", async () => {
      const res = await call("POST", "/quizzes", owner, baseQuiz({ proctoringEnabled: true }));
      assert.strictEqual(res.status, 201, res.text);
      assert.strictEqual(res.data.proctoringEnabled, true);
      assert.strictEqual(res.data.proctoringSetById, owner.id);
      assert.ok(res.data.proctoringSetAt);
      const audit = await prisma.auditEvent.findFirst({ where: { eventType: "PROCTORING_SETTING_CHANGED", userId: owner.id, metadata: { path: ["quizId"], equals: res.data.id } } });
      assert.ok(audit, "an audit event was written");
      assert.strictEqual(audit.metadata.enabled, true);
    });

    test("a Qualifying Test is eligible", async () => {
      const res = await call("POST", "/quizzes", owner, baseQuiz({ quizTag: "QUALIFYING", lessonId, proctoringEnabled: true }));
      assert.strictEqual(res.status, 201, res.text);
      assert.strictEqual(res.data.proctoringEnabled, true);
    });

    test("a Self-Test is refused through the API", async () => {
      const res = await call("POST", "/quizzes", owner, baseQuiz({ quizTag: "SELF_TEST", timeLimit: null, proctoringEnabled: true }));
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json.code, "PROCTORING_NOT_ALLOWED_ON_SELF_TEST");
    });

    test("no time limit is refused through the API", async () => {
      for (const timeLimit of [null, 0, undefined]) {
        const res = await call("POST", "/quizzes", owner, baseQuiz({ timeLimit, proctoringEnabled: true }));
        assert.strictEqual(res.status, 400, `timeLimit ${timeLimit}`);
        assert.strictEqual(res.json.code, "PROCTORING_REQUIRES_TIME_LIMIT");
      }
    });

    test("a time limit over 480 minutes is refused when proctored, and not otherwise", async () => {
      const refused = await call("POST", "/quizzes", owner, baseQuiz({ timeLimit: 481, proctoringEnabled: true }));
      assert.strictEqual(refused.status, 400);
      assert.strictEqual(refused.json.code, "PROCTORING_TIME_LIMIT_TOO_LONG");
      const fine = await call("POST", "/quizzes", owner, baseQuiz({ timeLimit: 481 }));
      assert.strictEqual(fine.status, 201);
    });

    test("ticking is refused while the feature is off", async () => {
      process.env.PROCTORING_ENABLED = "false";
      const res = await call("POST", "/quizzes", owner, baseQuiz({ proctoringEnabled: true }));
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.json.code, "PROCTORING_NOT_AVAILABLE");
      const off = await call("POST", "/quizzes", owner, baseQuiz({ proctoringEnabled: false }));
      assert.strictEqual(off.status, 201, "sending false still works with the feature off");
    });

    test("in production it also needs PROCTORING_LIVE_ALLOWED", async () => {
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";
      try {
        const res = await call("POST", "/quizzes", owner, baseQuiz({ proctoringEnabled: true }));
        assert.strictEqual(res.status, 403);
        assert.strictEqual(res.json.code, "PROCTORING_NOT_AVAILABLE");
        const config = await call("GET", "/proctoring/config", owner);
        assert.strictEqual(config.data.available, false);
      } finally {
        process.env.NODE_ENV = saved;
      }
    });

    test("the screen can ask whether it is available", async () => {
      const on = await call("GET", "/proctoring/config", owner);
      assert.strictEqual(on.status, 200);
      assert.strictEqual(on.data.available, true);
      process.env.PROCTORING_ENABLED = "false";
      assert.strictEqual((await call("GET", "/proctoring/config", owner)).data.available, false);
    });

    test("another course's instructor and a student cannot set it; an admin can", async () => {
      const quiz = await h.makeQuiz(course);
      assert.strictEqual((await call("PUT", `/quizzes/${quiz.id}`, other, { proctoringEnabled: true })).status, 403);
      assert.strictEqual((await call("PUT", `/quizzes/${quiz.id}`, student, { proctoringEnabled: true })).status, 403);
      assert.strictEqual((await prisma.quiz.findUnique({ where: { id: quiz.id } })).proctoringEnabled, false);
      const byAdmin = await call("PUT", `/quizzes/${quiz.id}`, admin, { proctoringEnabled: true });
      assert.strictEqual(byAdmin.status, 200, byAdmin.text);
      assert.strictEqual(byAdmin.data.proctoringEnabled, true);
      assert.strictEqual(byAdmin.data.proctoringSetById, admin.id);
    });
  });

  describe("changing a quiz later, before any attempt", () => {
    test("a ticked quiz cannot become a Self-Test or lose its time limit until unticked", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const toSelf = await call("PUT", `/quizzes/${quiz.id}`, owner, { quizTag: "SELF_TEST" });
      assert.strictEqual(toSelf.status, 400);
      assert.strictEqual(toSelf.json.code, "PROCTORING_NOT_ALLOWED_ON_SELF_TEST");
      const noTimer = await call("PUT", `/quizzes/${quiz.id}`, owner, { timeLimit: null });
      assert.strictEqual(noTimer.status, 400);
      assert.strictEqual(noTimer.json.code, "PROCTORING_REQUIRES_TIME_LIMIT");
      const untick = await call("PUT", `/quizzes/${quiz.id}`, owner, { proctoringEnabled: false, quizTag: "SELF_TEST" });
      assert.strictEqual(untick.status, 200, untick.text);
      assert.strictEqual(untick.data.proctoringEnabled, false);
      assert.strictEqual(untick.data.quizTag, "SELF_TEST");
    });

    test("ticking needs the stored values to qualify too", async () => {
      const self = await h.makeQuiz(course, { quizTag: "SELF_TEST", timeLimit: null, attempts: 0 });
      const refused = await call("PUT", `/quizzes/${self.id}`, owner, { proctoringEnabled: true });
      assert.strictEqual(refused.json.code, "PROCTORING_NOT_ALLOWED_ON_SELF_TEST");
      const untimed = await h.makeQuiz(course, { timeLimit: null });
      const refused2 = await call("PUT", `/quizzes/${untimed.id}`, owner, { proctoringEnabled: true });
      assert.strictEqual(refused2.json.code, "PROCTORING_REQUIRES_TIME_LIMIT");
    });

    test("ticking a quiz that already has unproctored attempts is refused", async () => {
      const quiz = await h.makeQuiz(course);
      await prisma.quizAttempt.create({ data: { quizId: quiz.id, studentId: student.studentId, attemptNumber: 1, answers: [], score: 0, totalMarks: 1, percentage: 0 } });
      const res = await call("PUT", `/quizzes/${quiz.id}`, owner, { proctoringEnabled: true });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "PROCTORING_LOCKED");
    });

    test("an unticked quiz with attempts can still change its tag and time limit", async () => {
      const quiz = await h.makeQuiz(course);
      await prisma.quizAttempt.create({ data: { quizId: quiz.id, studentId: student.studentId, attemptNumber: 1, answers: [], score: 0, totalMarks: 1, percentage: 0 } });
      const res = await call("PUT", `/quizzes/${quiz.id}`, owner, { timeLimit: 45, quizTag: "QUALIFYING", lessonId: undefined });
      assert.ok([200, 400].includes(res.status));
      const time = await call("PUT", `/quizzes/${quiz.id}`, owner, { timeLimit: 45 });
      assert.strictEqual(time.status, 200);
      assert.strictEqual(time.data.timeLimit, 45);
    });
  });

  describe("the lock, once a readiness check has started", () => {
    let quiz;
    let question;

    before(async () => {
      quiz = await h.makeQuiz(course, { proctoringEnabled: true, questionCount: 2 });
      question = quiz.quizQuestions[0].question;
      await addAttempt(quiz);
    });

    test("the instructor read says it is locked", async () => {
      const res = await call("GET", `/quizzes/${quiz.id}`, owner);
      assert.strictEqual(res.data.proctoringLocked, true);
    });

    test("the checkbox, tag and time limit cannot change", async () => {
      for (const change of [{ proctoringEnabled: false }, { quizTag: "SELF_TEST" }, { timeLimit: 45 }, { timeLimit: null }]) {
        const res = await call("PUT", `/quizzes/${quiz.id}`, owner, change);
        assert.strictEqual(res.status, 409, JSON.stringify(change));
        assert.strictEqual(res.json.code, "PROCTORING_LOCKED");
      }
      const row = await prisma.quiz.findUnique({ where: { id: quiz.id } });
      assert.strictEqual(row.proctoringEnabled, true);
      assert.strictEqual(row.timeLimit, 30);
    });

    test("an admin is locked out too", async () => {
      const res = await call("PUT", `/quizzes/${quiz.id}`, admin, { proctoringEnabled: false });
      assert.strictEqual(res.status, 409);
    });

    test("resending the same values and editing the title still work", async () => {
      const res = await call("PUT", `/quizzes/${quiz.id}`, owner, { title: "Renamed", proctoringEnabled: true, quizTag: "FINAL", timeLimit: 30 });
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.data.title, "Renamed");
    });

    test("questions cannot change through the quiz", async () => {
      const res = await call("PUT", `/quizzes/${quiz.id}`, owner, { questions: [{ question: "New?", options: ["a"], correctAnswer: "a" }] });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "PROCTORING_LOCKED");
      assert.strictEqual(await prisma.quizQuestion.count({ where: { quizId: quiz.id } }), 2);
    });

    test("questions cannot be added, removed, reordered or re-marked", async () => {
      const extra = await prisma.question.create({ data: { courseId: course.id, question: "Extra?", options: ["a"], correctAnswer: "a", createdBy: owner.id } });
      const ids = quiz.quizQuestions.map((q) => q.questionId);
      for (const [method, url, body] of [
        ["POST", `/quizzes/${quiz.id}/import-questions`, { questionIds: [extra.id] }],
        ["DELETE", `/quizzes/${quiz.id}/questions/${ids[0]}`, undefined],
        ["PUT", `/quizzes/${quiz.id}/questions/reorder`, { orderedQuestionIds: [ids[1], ids[0]] }],
        ["PUT", `/quizzes/${quiz.id}/questions/${ids[0]}/marks`, { marks: 5 }],
        ["POST", "/questions/bulk", { quizId: quiz.id, questions: [{ question: "Bulk?", questionType: "MCQ_SINGLE", options: ["a", "b"], correctAnswer: "a" }] }],
      ]) {
        const res = await call(method, url, owner, body);
        assert.strictEqual(res.status, 409, `${method} ${url}: ${res.text}`);
        assert.strictEqual(res.json.code, "PROCTORING_LOCKED");
      }
      assert.strictEqual(await prisma.quizQuestion.count({ where: { quizId: quiz.id } }), 2);
    });

    test("the shared question-bank row cannot be edited, archived or deleted", async () => {
      for (const [method, url, body] of [
        ["PUT", `/questions/${question.id}`, { question: "Changed?" }],
        ["POST", `/questions/${question.id}/archive`, undefined],
        ["DELETE", `/questions/${question.id}`, undefined],
      ]) {
        const res = await call(method, url, owner, body);
        assert.strictEqual(res.status, 409, `${method} ${url}: ${res.text}`);
        assert.strictEqual(res.json.code, "PROCTORING_LOCKED");
      }
      const row = await prisma.question.findUnique({ where: { id: question.id } });
      assert.strictEqual(row.question, question.question);
      assert.strictEqual(row.status, "ACTIVE");
    });

    test("the quiz cannot be deleted, through any path", async () => {
      const direct = await call("DELETE", `/quizzes/${quiz.id}`, owner);
      assert.strictEqual(direct.status, 409, direct.text);
      assert.strictEqual(direct.json.code, "PROCTORED_QUIZ_HAS_ATTEMPTS");
      const wrapper = await prisma.content.findUnique({ where: { quizId: quiz.id } });
      const viaContent = await call("DELETE", `/contents/${wrapper.id}`, owner);
      assert.strictEqual(viaContent.status, 409, viaContent.text);
      assert.ok(await prisma.quiz.findUnique({ where: { id: quiz.id } }));
      assert.ok(await prisma.content.findUnique({ where: { id: wrapper.id } }), "the place in the course is kept");
    });
  });

  describe("quizzes without the checkbox are not locked", () => {
    test("question edits and deletion work as before", async () => {
      const quiz = await h.makeQuiz(course);
      const q = quiz.quizQuestions[0].question;
      assert.strictEqual((await call("PUT", `/questions/${q.id}`, owner, { question: "Edited?" })).status, 200);
      assert.strictEqual((await call("PUT", `/quizzes/${quiz.id}/questions/${q.id}/marks`, owner, { marks: 3 })).status, 200);
      assert.strictEqual((await call("DELETE", `/quizzes/${quiz.id}`, owner)).status, 200);
    });

    test("a ticked quiz with no attempt can still be edited and deleted", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const q = quiz.quizQuestions[0].question;
      assert.strictEqual((await call("PUT", `/questions/${q.id}`, owner, { question: "Edited?" })).status, 200);
      assert.strictEqual((await call("GET", `/quizzes/${quiz.id}`, owner)).data.proctoringLocked, false);
      assert.strictEqual((await call("DELETE", `/quizzes/${quiz.id}`, owner)).status, 200);
    });
  });

  describe("imported quizzes", () => {
    test("no importer can switch it on: none copies the field, so the column default applies", () => {
      const dir = path.resolve(__dirname, "../src/modules/course-import/services");
      for (const file of ["v2PackageImporter.service.js", "courseImporter.service.js", "physicalPackageImporter.service.js", "flexibleCourseJson.service.js"]) {
        assert.ok(!/proctoring/i.test(fs.readFileSync(path.join(dir, file), "utf8")), file);
      }
    });

    test("a row written without the field is off", async () => {
      const row = await prisma.quiz.create({ data: { title: "Imported", passingScore: 50, courseId: course.id } });
      assert.strictEqual(row.proctoringEnabled, false);
    });
  });
});
