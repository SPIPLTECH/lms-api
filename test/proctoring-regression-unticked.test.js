/**
 * Regression suite: a quiz WITHOUT the proctoring checkbox behaves exactly as it
 * did before proctoring existed.
 *
 * Real HTTP through the real Express app, against the disposable local database
 * (TEST_DATABASE_URL). Runs only when that is set. For each quiz tag it records
 * every student and instructor response and how many database queries each took
 * (the Server-Timing header), then compares with the golden file captured from
 * the code before any proctoring change:
 *   test/fixtures/proctoring-unticked-baseline.json
 *
 * The ONLY allowed differences are the new, inert columns on the quiz row, listed
 * in ALLOWED_NEW_KEYS, which must read as off. To rewrite the golden file (only
 * legitimately done once, on the unchanged base code):
 *   PROCTORING_BASELINE_WRITE=1 node scripts/proctoring-local/test.js test/proctoring-regression-unticked.test.js
 */
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const GOLDEN = path.join(__dirname, "fixtures", "proctoring-unticked-baseline.json");
const WRITE = process.env.PROCTORING_BASELINE_WRITE === "1";

const ALLOWED_NEW_KEYS = new Set(["proctoringEnabled", "proctoringSetById", "proctoringSetAt"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const CUID = /^c[a-z0-9]{20,}$/;

/** Removes what legitimately changes between runs, and the inert new columns. */
function normalize(value, seenNewKeys) {
  if (Array.isArray(value)) return value.map((v) => normalize(v, seenNewKeys));
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (ALLOWED_NEW_KEYS.has(key)) {
        seenNewKeys.push([key, value[key]]);
        continue;
      }
      // A graded quiz's options are shuffled on every read, by design (withheldOptions).
      const raw = value[key];
      const stable = key === "options" && Array.isArray(raw) && raw.every((o) => typeof o === "string") ? [...raw].sort() : raw;
      out[key] = normalize(stable, seenNewKeys);
    }
    return out;
  }
  if (typeof value === "string" && ISO_DATE.test(value)) return "<date>";
  if (typeof value === "string" && CUID.test(value)) return "<id>";
  return value;
}

const queriesFrom = (response) => {
  const match = /desc="(\d+) queries"/.exec(response.headers.get("server-timing") || "");
  return match ? Number(match[1]) : null;
};

describe("quizzes without the checkbox are unchanged", { skip: HAS_TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  const bcrypt = require("bcrypt");
  const prisma = require("../src/config/database");
  const quizService = require("../src/modules/quizzes/quiz.service");
  const app = require("../src/app");

  const PASSWORD = "Str0ng!Pass-regression";
  const P = "regq";
  const IDS = {
    instructor: `${P}-instructor`,
    student: `${P}-student`,
    course: `${P}-course`,
    sequentialCourse: `${P}-sequential`,
    module: `${P}-module`,
    lesson: `${P}-lesson`,
  };
  const QUIZZES = [
    { id: `${P}-final`, tag: "FINAL", timeLimit: 20, attempts: 2, lessonScoped: false },
    { id: `${P}-self`, tag: "SELF_TEST", timeLimit: null, attempts: 0, lessonScoped: false },
    { id: `${P}-qual`, tag: "QUALIFYING", timeLimit: 15, attempts: 2, lessonScoped: true },
  ];

  let server;
  let baseUrl;
  let studentAuth;
  let instructorAuth;
  const recorded = {};

  const cleanup = async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: [IDS.instructor, IDS.student] } } });
    await prisma.course.deleteMany({ where: { id: { in: [IDS.course, IDS.sequentialCourse] } } });
    await prisma.question.deleteMany({ where: { id: { startsWith: `${P}-q` } } });
    await prisma.authSession.deleteMany({ where: { userId: { in: [IDS.instructor, IDS.student] } } });
    await prisma.user.deleteMany({ where: { id: { in: [IDS.instructor, IDS.student] } } });
  };

  const addQuiz = async ({ id, tag, timeLimit, attempts, lessonScoped }, courseId, order) => {
    await prisma.quiz.create({
      data: {
        id,
        title: `Quiz ${id}`,
        quizTag: tag,
        passingScore: 50,
        timeLimit,
        attempts,
        courseId,
        ...(lessonScoped ? { moduleId: IDS.module, lessonId: IDS.lesson } : {}),
      },
    });
    if (tag !== "QUALIFYING") {
      await prisma.content.create({ data: { id: `${id}-content`, type: "QUIZ", title: `Quiz ${id}`, order, quizId: id, courseId } });
    }
    await prisma.question.create({
      data: { id: `${P}-q-${id}`, courseId, question: `Question for ${id}?`, questionType: "MCQ_SINGLE", options: ["right", "wrong"], correctAnswer: "right", marks: 1, explanation: "because", hint: "think" },
    });
    await prisma.quizQuestion.create({ data: { id: `${id}-qq`, quizId: id, questionId: `${P}-q-${id}`, order: 1, marks: 1 } });
  };

  const login = async (email) => {
    const res = await fetch(`${baseUrl}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PASSWORD }) });
    const body = await res.json();
    assert.strictEqual(res.status, 200, `login failed for ${email}`);
    const data = body.data || body;
    return { token: data.accessToken || data.token, deviceKey: data.deviceKey };
  };

  const call = async (label, method, url, authInfo, jsonBody) => {
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers: {
        Authorization: `Bearer ${authInfo.token}`,
        "X-Device-Key": authInfo.deviceKey,
        ...(jsonBody ? { "Content-Type": "application/json" } : {}),
      },
      body: jsonBody ? JSON.stringify(jsonBody) : undefined,
    });
    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    const newKeys = [];
    recorded[label] = { status: res.status, queries: queriesFrom(res), body: normalize(parsed, newKeys) };
    for (const [key, value] of newKeys) {
      if (key === "proctoringEnabled") assert.strictEqual(value, false, `${label}: ${key} must be off`);
      else assert.strictEqual(value, null, `${label}: ${key} must be empty`);
    }
    return recorded[label];
  };

  before(async () => {
    await cleanup();
    const password = await bcrypt.hash(PASSWORD, 4);
    await prisma.user.create({ data: { id: IDS.instructor, name: "Regression Instructor", email: "regq-instructor@regression.example.com", password, role: "INSTRUCTOR", isVerified: true } });
    await prisma.user.create({ data: { id: IDS.student, name: "Regression Student", email: "regq-student@regression.example.com", password, role: "STUDENT", isVerified: true, studentProfile: { create: { id: `${IDS.student}-profile` } } } });
    await prisma.course.create({ data: { id: IDS.course, title: "Regression course", status: "PUBLISHED", creatorId: IDS.instructor, sequentialLearning: false } });
    await prisma.course.create({ data: { id: IDS.sequentialCourse, title: "Regression sequential course", status: "PUBLISHED", creatorId: IDS.instructor, sequentialLearning: true } });
    await prisma.module.create({ data: { id: IDS.module, title: "Module", order: 1, courseId: IDS.course, isPublished: true } });
    await prisma.lesson.create({ data: { id: IDS.lesson, title: "Lesson", order: 1, moduleId: IDS.module, isPublished: true } });
    await prisma.enrollment.create({ data: { courseId: IDS.course, studentId: `${IDS.student}-profile` } });
    await prisma.enrollment.create({ data: { courseId: IDS.sequentialCourse, studentId: `${IDS.student}-profile` } });
    let order = 1;
    for (const quiz of QUIZZES) await addQuiz(quiz, IDS.course, order++);
    await addQuiz({ id: `${P}-seq-a`, tag: "FINAL", timeLimit: 10, attempts: 1, lessonScoped: false }, IDS.sequentialCourse, 1);
    await addQuiz({ id: `${P}-seq-b`, tag: "FINAL", timeLimit: null, attempts: 1, lessonScoped: false }, IDS.sequentialCourse, 2);

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    studentAuth = await login("regq-student@regression.example.com");
    instructorAuth = await login("regq-instructor@regression.example.com");

    for (const quiz of QUIZZES) {
      await call(`${quiz.tag} instructor read`, "GET", `/quizzes/${quiz.id}`, instructorAuth);
      await call(`${quiz.tag} student read`, "GET", `/quizzes/${quiz.id}`, studentAuth);
      await call(`${quiz.tag} result before attempt`, "GET", `/quizzes/${quiz.id}/result`, studentAuth);
      await call(`${quiz.tag} wrong answer submit`, "POST", `/quizzes/${quiz.id}/submit`, studentAuth, {
        answers: [{ questionId: `${P}-q-${quiz.id}`, answer: "wrong" }],
        timeTakenSeconds: 30,
      });
      await quizService.flushPendingMisconceptionClassifications();
      await call(`${quiz.tag} result after wrong answer`, "GET", `/quizzes/${quiz.id}/result`, studentAuth);
      await call(`${quiz.tag} right answer submit`, "POST", `/quizzes/${quiz.id}/submit`, studentAuth, {
        answers: [{ questionId: `${P}-q-${quiz.id}`, answer: "right" }],
      });
      await quizService.flushPendingMisconceptionClassifications();
      await call(`${quiz.tag} result after right answer`, "GET", `/quizzes/${quiz.id}/result`, studentAuth);
      await call(`${quiz.tag} instructor edit`, "PUT", `/quizzes/${quiz.id}`, instructorAuth, { description: "Edited", timeLimit: quiz.tag === "SELF_TEST" ? null : 25 });
    }
    await call("student quiz list", "GET", `/quizzes?courseId=${IDS.course}`, studentAuth);
    await call("instructor quiz list", "GET", `/quizzes?courseId=${IDS.course}`, instructorAuth);
    await call("my submissions", "GET", "/quizzes/my-submissions", studentAuth);
    await call("course progress", "GET", `/progress/courses/${IDS.course}`, studentAuth);
    await call("instructor final tests", "GET", `/results/final-tests?courseId=${IDS.course}`, instructorAuth);
    await call("self generate", "POST", "/quizzes/self-generate", studentAuth, { courseId: IDS.course, questionCount: 1 });

    // Sequential course: the second quiz is locked until the first is done.
    await call("sequence locked read", "GET", `/quizzes/${P}-seq-b`, studentAuth);
    await call("sequence first submit", "POST", `/quizzes/${P}-seq-a/submit`, studentAuth, { answers: [{ questionId: `${P}-q-${P}-seq-a`, answer: "right" }] });
    await quizService.flushPendingMisconceptionClassifications();
    await call("sequence unlocked read", "GET", `/quizzes/${P}-seq-b`, studentAuth);
    await call("learning sequence", "GET", `/progress/learning-sequence?courseId=${IDS.sequentialCourse}`, studentAuth);

    if (WRITE) {
      fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
      fs.writeFileSync(GOLDEN, `${JSON.stringify(recorded, null, 2)}\n`);
    }
  });

  after(async () => {
    server?.close();
    await prisma.quiz.deleteMany({ where: { title: "Self-Assessment Practice Quiz", courseId: IDS.course } }).catch(() => {});
    await cleanup().catch(() => {});
    await prisma.$disconnect().catch(() => {});
  });

  test("every recorded response matches the golden baseline, status and body", () => {
    assert.ok(fs.existsSync(GOLDEN), "the golden baseline exists");
    const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
    assert.deepStrictEqual(Object.keys(recorded).sort(), Object.keys(golden).sort());
    for (const label of Object.keys(golden)) {
      assert.strictEqual(recorded[label].status, golden[label].status, `${label}: status`);
      assert.deepStrictEqual(recorded[label].body, golden[label].body, `${label}: body`);
    }
  });

  test("no response needs more database queries than the golden baseline", () => {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
    for (const label of Object.keys(golden)) {
      assert.ok(typeof recorded[label].queries === "number", `${label}: query count was reported`);
      assert.ok(recorded[label].queries <= golden[label].queries, `${label}: ${recorded[label].queries} queries, baseline ${golden[label].queries}`);
    }
  });
});
