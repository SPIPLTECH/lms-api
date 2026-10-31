/**
 * Shared set-up for proctoring tests: the real Express app over real HTTP, against
 * the disposable local database (TEST_DATABASE_URL). Everything created carries a
 * per-run prefix and is removed afterwards.
 */
const assert = require("node:assert");
const crypto = require("crypto");
const bcrypt = require("bcrypt");

const prisma = require("../../src/config/database");
const app = require("../../src/app");

const PASSWORD = "Str0ng!Pass-proctoring";

function createHarness(label) {
  const run = `${label}-${crypto.randomBytes(3).toString("hex")}`;
  const state = { server: null, baseUrl: null, userIds: [], courseIds: [], quizIds: [] };

  const start = async () => {
    state.server = app.listen(0);
    await new Promise((resolve) => state.server.once("listening", resolve));
    state.baseUrl = `http://127.0.0.1:${state.server.address().port}`;
  };

  const stop = async () => {
    state.server?.close();
    await prisma.proctoredAttempt.deleteMany({ where: { courseId: { in: state.courseIds } } }).catch(() => {});
    await prisma.notification.deleteMany({ where: { userId: { in: state.userIds } } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { userId: { in: state.userIds } } }).catch(() => {});
    await prisma.proctoringConsent.deleteMany({ where: { userId: { in: state.userIds } } }).catch(() => {});
    await prisma.question.deleteMany({ where: { createdBy: { in: state.userIds } } }).catch(() => {});
    await prisma.question.deleteMany({ where: { courseId: { in: state.courseIds } } }).catch(() => {});
    await prisma.course.deleteMany({ where: { id: { in: state.courseIds } } }).catch(() => {});
    await prisma.authSession.deleteMany({ where: { userId: { in: state.userIds } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: state.userIds } } }).catch(() => {});
    await prisma.$disconnect().catch(() => {});
  };

  const makeUser = async (role, name) => {
    const email = `${name.toLowerCase()}-${run}@proctoring-test.example.com`;
    const user = await prisma.user.create({
      data: {
        name: `${name} ${run}`,
        email,
        password: await bcrypt.hash(PASSWORD, 4),
        role,
        isVerified: true,
        status: "ACTIVE",
        ...(role === "STUDENT" ? { studentProfile: { create: {} } } : {}),
      },
      include: { studentProfile: true },
    });
    state.userIds.push(user.id);
    const res = await fetch(`${state.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const body = await res.json();
    assert.strictEqual(res.status, 200, `login failed for ${name}: ${JSON.stringify(body)}`);
    const data = body.data || body;
    return { id: user.id, role, email, studentId: user.studentProfile?.id ?? null, token: data.accessToken || data.token, deviceKey: data.deviceKey };
  };

  const makeCourse = async (creatorId, extra = {}) => {
    const course = await prisma.course.create({
      data: { title: `Course ${run}`, status: "PUBLISHED", creatorId, sequentialLearning: false, ...extra },
    });
    state.courseIds.push(course.id);
    return course;
  };

  /** A quiz with one question, written straight to the database (bypasses the API rules). */
  const makeQuiz = async (course, overrides = {}) => {
    const { questionCount = 1, ...quizFields } = overrides;
    const quiz = await prisma.quiz.create({
      data: { title: `Quiz ${crypto.randomBytes(3).toString("hex")}`, quizTag: "FINAL", passingScore: 50, timeLimit: 30, attempts: 1, courseId: course.id, ...quizFields },
    });
    const last = await prisma.content.aggregate({ where: { courseId: course.id, moduleId: null, lessonId: null, topicId: null, subTopicId: null, conceptId: null }, _max: { order: true } });
    await prisma.content.create({ data: { type: "QUIZ", title: quiz.title, order: (last._max.order || 0) + 1, quizId: quiz.id, courseId: course.id } });
    for (let i = 1; i <= questionCount; i += 1) {
      const question = await prisma.question.create({
        data: { courseId: course.id, question: `Question ${i} of ${quiz.id}?`, questionType: "MCQ_SINGLE", options: ["right", "wrong"], correctAnswer: "right", marks: 1, explanation: "because", hint: "think", createdBy: course.creatorId },
      });
      await prisma.quizQuestion.create({ data: { quizId: quiz.id, questionId: question.id, order: i, marks: 1 } });
    }
    return prisma.quiz.findUnique({ where: { id: quiz.id }, include: { quizQuestions: { orderBy: { order: "asc" }, include: { question: true } } } });
  };

  const enroll = (course, student) => prisma.enrollment.create({ data: { courseId: course.id, studentId: student.studentId } });

  const call = async (method, url, auth, body, headers = {}) => {
    const res = await fetch(`${state.baseUrl}${url}`, {
      method,
      headers: {
        ...(auth?.token ? { Authorization: `Bearer ${auth.token}`, "X-Device-Key": auth.deviceKey } : {}),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, json, data: json?.data ?? json, text, headers: res.headers };
  };

  return { run, state, start, stop, makeUser, makeCourse, makeQuiz, enroll, call, prisma, baseUrl: () => state.baseUrl };
}

module.exports = { createHarness };
