/**
 * Server-side exam state for proctored quizzes, and every route a student could use
 * to get round it. Real HTTP, disposable local database. Monitoring readiness is
 * written straight to the row here; the monitoring tests cover how it gets there.
 */
const { describe, test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const EDGE = `${CHROME} Edg/150.0.0.0`;
const PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Mobile Safari/537.36";
const FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const OLD_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.0.0 Safari/537.36";

describe("proctored exam state", { skip: HAS_TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  const { createHarness } = require("./helpers/proctoringHarness");
  const { startFakeAi } = require("./helpers/fakeAi");
  const h = createHarness("att");
  const { prisma, call } = h;
  const browser = { "User-Agent": CHROME };
  let ai;
  let owner;
  let course;
  let consent;

  const newStudent = async (name = "Student") => {
    const student = await h.makeUser("STUDENT", `${name}${Math.random().toString(36).slice(2, 7)}`);
    await h.enroll(course, student);
    return student;
  };
  const accept = () => ({ consent: { wordingVersion: consent.wordingVersion, accepted: true } });
  const begin = (quiz, student) => call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, accept(), browser);
  const makeReady = (attemptId) =>
    prisma.proctoredAttempt.update({ where: { id: attemptId }, data: { identityCheck: "FACE_CHECK_PASSED", cameraSeenAt: new Date(), microphoneStatus: "GRANTED" } });
  const startedExam = async (quiz, student) => {
    const created = await begin(quiz, student);
    assert.strictEqual(created.status, 201, created.text);
    await makeReady(created.data.attemptId);
    const started = await call("POST", `/proctoring/attempts/${created.data.attemptId}/start`, student, undefined, browser);
    assert.strictEqual(started.status, 200, started.text);
    return created.data.attemptId;
  };
  const questionId = (quiz, index = 0) => quiz.quizQuestions[index].questionId;
  const save = (attemptId, student, qId, answer, clientRevision = 1) =>
    call("PUT", `/proctoring/attempts/${attemptId}/answers/${qId}`, student, { answer, clientRevision });

  before(async () => {
    process.env.PROCTORING_ENABLED = "true";
    ai = await startFakeAi();
    await h.start();
    owner = await h.makeUser("INSTRUCTOR", "Owner");
    course = await h.makeCourse(owner.id);
    const probe = await newStudent("Probe");
    const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
    const status = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, probe);
    assert.strictEqual(status.status, 200, status.text);
    consent = status.data.consent;
  });

  beforeEach(() => {
    process.env.PROCTORING_ENABLED = "true";
  });

  after(async () => {
    await h.stop();
    await ai.stop();
  });

  describe("existing routes refuse a proctored quiz", () => {
    test("a student reading the quiz gets no questions or answers; the instructor still does", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, questionCount: 2 });
      const student = await newStudent();
      const res = await call("GET", `/quizzes/${quiz.id}`, student);
      assert.strictEqual(res.status, 200, res.text);
      assert.deepStrictEqual(res.data.questions, []);
      assert.strictEqual(res.data.proctoringEnabled, true);
      assert.ok(!res.text.includes("Question 1 of"), "no question text anywhere in the response");
      assert.ok(!res.text.includes("correctAnswer"));
      assert.ok(res.data.attemptStatus, "the allowance is still reported");
      const staff = await call("GET", `/quizzes/${quiz.id}`, owner);
      assert.strictEqual(staff.data.questions.length, 2);
    });

    test("direct submit is refused and writes nothing", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const res = await call("POST", `/quizzes/${quiz.id}/submit`, student, { answers: [{ questionId: questionId(quiz), answer: "right" }] });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "PROCTORED_QUIZ_USE_SECURE_ROUTE");
      assert.strictEqual(await prisma.quizAttempt.count({ where: { quizId: quiz.id } }), 0);
      assert.strictEqual(await prisma.quizSubmission.count({ where: { quizId: quiz.id } }), 0);
    });

    test("self-generate never draws on a proctored quiz's questions, including ones shared with another quiz", async () => {
      const isolated = await h.makeCourse(owner.id);
      const student = await h.makeUser("STUDENT", "SelfGen");
      await h.enroll(isolated, student);
      const proctored = await h.makeQuiz(isolated, { proctoringEnabled: true });
      const onlyProctored = await call("POST", "/quizzes/self-generate", student, { courseId: isolated.id, questionCount: 5 });
      assert.strictEqual(onlyProctored.status, 404, onlyProctored.text);

      const open = await h.makeQuiz(isolated);
      await prisma.quizQuestion.create({ data: { quizId: open.id, questionId: questionId(proctored), order: 2, marks: 1 } });
      const generated = await call("POST", "/quizzes/self-generate", student, { courseId: isolated.id, questionCount: 5 });
      assert.strictEqual(generated.status, 201, generated.text);
      const links = await prisma.quizQuestion.findMany({ where: { quizId: generated.data.id }, select: { questionId: true } });
      assert.deepStrictEqual(links.map((l) => l.questionId), [questionId(open)]);
    });

    test("the question routes stay closed to students", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      for (const url of [`/questions/quiz/${quiz.id}`, `/questions/${quiz.id}`, `/questions?quizId=${quiz.id}`]) {
        assert.strictEqual((await call("GET", url, student)).status, 403, url);
      }
    });
  });

  describe("starting", () => {
    test("a quiz without the checkbox has no proctored route", async () => {
      const quiz = await h.makeQuiz(course);
      const student = await newStudent();
      const res = await begin(quiz, student);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.json.code, "QUIZ_NOT_PROCTORED");
      assert.strictEqual(await prisma.proctoredAttempt.count({ where: { quizId: quiz.id } }), 0);
    });

    test("status tells the student what is needed, with the consent wording", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, timeLimit: 45 });
      const student = await newStudent();
      const res = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student);
      assert.strictEqual(res.data.canStart, true);
      assert.strictEqual(res.data.durationMinutes, 45);
      assert.ok(res.data.consent.wordingVersion);
      assert.ok(res.data.consent.text.length > 0);
      assert.strictEqual(res.data.attempt, null);
    });

    test("no consent, or an out-of-date wording, is refused and creates nothing", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      for (const body of [{}, { consent: { accepted: false, wordingVersion: consent.wordingVersion } }, { consent: { accepted: true, wordingVersion: "old" } }]) {
        const res = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, body, browser);
        assert.strictEqual(res.status, 400, JSON.stringify(body));
        assert.strictEqual(res.json.code, "CONSENT_REQUIRED");
      }
      assert.strictEqual(await prisma.proctoredAttempt.count({ where: { quizId: quiz.id } }), 0);
      assert.strictEqual(await prisma.proctoringConsent.count({ where: { quizId: quiz.id } }), 0);
    });

    test("consent is recorded with the time and wording version", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const res = await begin(quiz, student);
      assert.strictEqual(res.status, 201, res.text);
      const row = await prisma.proctoringConsent.findFirst({ where: { quizId: quiz.id, userId: student.id } });
      assert.strictEqual(row.wordingVersion, consent.wordingVersion);
      assert.ok(row.wordingHash);
      assert.ok(row.acceptedAt);
      assert.strictEqual(row.attemptId, res.data.attemptId);
    });

    test("only laptops and desktops on current Chrome or Edge", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      for (const ua of [PHONE, FIREFOX, OLD_CHROME]) {
        const res = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, accept(), { "User-Agent": ua });
        assert.strictEqual(res.status, 403, ua);
        assert.strictEqual(res.json.code, "DEVICE_NOT_ALLOWED");
      }
      const mobileHint = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, accept(), { "User-Agent": CHROME, "Sec-CH-UA-Mobile": "?1" });
      assert.strictEqual(mobileHint.status, 403);
      const edge = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, accept(), { "User-Agent": EDGE });
      assert.strictEqual(edge.status, 201, edge.text);
    });

    test("not enrolled, the feature off, and a student who is not this one", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const outsider = await h.makeUser("STUDENT", "Outsider");
      assert.strictEqual((await begin(quiz, outsider)).status, 403);
      const student = await newStudent();
      process.env.PROCTORING_ENABLED = "false";
      const off = await begin(quiz, student);
      assert.strictEqual(off.status, 503);
      assert.strictEqual(off.json.code, "PROCTORING_UNAVAILABLE");
      assert.strictEqual(await prisma.proctoredAttempt.count({ where: { quizId: quiz.id } }), 0, "no attempt was used");
    });

    test("the same device beginning again gets the same attempt", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const first = await begin(quiz, student);
      const second = await begin(quiz, student);
      assert.strictEqual(second.status, 201);
      assert.strictEqual(second.data.attemptId, first.data.attemptId);
      assert.strictEqual(await prisma.proctoredAttempt.count({ where: { quizId: quiz.id, userId: student.id } }), 1);
    });

    test("questions cannot be read before the exam starts", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const { data } = await begin(quiz, student);
      const res = await call("GET", `/proctoring/attempts/${data.attemptId}`, student);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.questions, undefined);
      assert.ok(!res.text.includes("Question 1 of"));
    });

    test("start is refused until the readiness steps have passed, on the server", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const { data } = await begin(quiz, student);
      const notReady = await call("POST", `/proctoring/attempts/${data.attemptId}/start`, student);
      assert.strictEqual(notReady.status, 409);
      assert.strictEqual(notReady.json.code, "NOT_READY");
      assert.ok(notReady.json.errors.includes("IDENTITY_CHECK_NOT_PASSED"));
      assert.ok(notReady.json.errors.includes("CAMERA_NOT_SEEN"));

      await prisma.proctoredAttempt.update({ where: { id: data.attemptId }, data: { identityCheck: "FACE_CHECK_FAILED", cameraSeenAt: new Date() } });
      const failedCheck = await call("POST", `/proctoring/attempts/${data.attemptId}/start`, student);
      assert.strictEqual(failedCheck.status, 409, "a failed face check blocks entry");
      assert.deepStrictEqual(failedCheck.json.errors, ["IDENTITY_CHECK_NOT_PASSED"]);
    });

    test("start sets the deadline from the server clock, once, and a refused microphone is recorded", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, timeLimit: 20 });
      const student = await newStudent();
      const { data } = await begin(quiz, student);
      await prisma.proctoredAttempt.update({ where: { id: data.attemptId }, data: { identityCheck: "FACE_CHECK_PASSED", cameraSeenAt: new Date() } });
      const before = Date.now();
      const started = await call("POST", `/proctoring/attempts/${data.attemptId}/start`, student);
      assert.strictEqual(started.status, 200, started.text);
      assert.strictEqual(started.data.status, "IN_PROGRESS");
      const deadline = new Date(started.data.deadlineAt).getTime();
      assert.ok(deadline >= before + 20 * 60_000 - 1000 && deadline <= Date.now() + 20 * 60_000 + 1000);
      const again = await call("POST", `/proctoring/attempts/${data.attemptId}/start`, student);
      assert.strictEqual(again.data.deadlineAt, started.data.deadlineAt, "a repeat never moves the deadline");
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: data.attemptId } });
      assert.strictEqual(row.microphoneStatus, "REFUSED", "never reported counts as refused");
    });

    test("the monitoring token is not stored or put in a URL", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const { data } = await begin(quiz, student);
      assert.ok(data.monitoringToken);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: data.attemptId } });
      assert.ok(!JSON.stringify(row).includes(data.monitoringToken));
    });
  });

  describe("during the exam", () => {
    test("questions are sent without answers, explanations or hints", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, questionCount: 2 });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      const res = await call("GET", `/proctoring/attempts/${attemptId}`, student);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.data.questions.length, 2);
      for (const key of ["correctAnswer", "explanation", '"hint"']) assert.ok(!res.text.includes(key), key);
      assert.ok(res.data.serverNow);
      assert.ok(res.data.deadlineAt);
    });

    test("answers are saved on the server, the latest revision wins, and a refresh gets them back", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      const q = questionId(quiz);
      assert.strictEqual((await save(attemptId, student, q, "wrong", 2)).data.stale, false);
      const stale = await save(attemptId, student, q, "right", 1);
      assert.strictEqual(stale.data.stale, true);
      const state = await call("GET", `/proctoring/attempts/${attemptId}`, student);
      assert.strictEqual(state.data.answers.find((a) => a.questionId === q).answer, "wrong");
    });

    test("every answer shape is accepted", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      const q = questionId(quiz);
      for (const [revision, answer] of [[1, "text"], [2, ["a", "b"]], [3, { left: "right" }]]) {
        const res = await save(attemptId, student, q, answer, revision);
        assert.strictEqual(res.status, 200, JSON.stringify(answer));
      }
    });

    test("a question from another quiz is refused", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const other = await h.makeQuiz(course);
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      assert.strictEqual((await save(attemptId, student, questionId(other), "right")).status, 400);
    });

    test("another student cannot read, answer, start, resume or submit it", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const intruder = await newStudent("Intruder");
      const attemptId = await startedExam(quiz, student);
      for (const [method, url, body] of [
        ["GET", `/proctoring/attempts/${attemptId}`],
        ["PUT", `/proctoring/attempts/${attemptId}/answers/${questionId(quiz)}`, { answer: "x", clientRevision: 9 }],
        ["POST", `/proctoring/attempts/${attemptId}/start`],
        ["POST", `/proctoring/attempts/${attemptId}/resume`],
        ["POST", `/proctoring/attempts/${attemptId}/submit`],
      ]) {
        assert.strictEqual((await call(method, url, intruder, body)).status, 403, `${method} ${url}`);
      }
      assert.strictEqual((await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } })).status, "IN_PROGRESS");
    });

    test("the video lease on another device cannot block saving or submitting", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      const session = await prisma.authSession.findFirst({ where: { userId: student.id, status: "ACTIVE" } });
      const otherDevice = await prisma.device.create({ data: { userId: student.id, deviceKeyHash: `other-${attemptId}` } });
      const otherSession = await prisma.authSession.create({ data: { userId: student.id, deviceId: otherDevice.id, tokenHash: `other-${attemptId}`, authMethod: "PASSWORD", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiry: new Date(Date.now() + 3_600_000) } });
      const content = await prisma.content.findUnique({ where: { quizId: quiz.id } });
      await prisma.playbackLease.create({ data: { userId: student.id, sessionId: otherSession.id, deviceId: otherDevice.id, contentId: content.id, expiresAt: new Date(Date.now() + 60_000) } });
      assert.ok(session);
      assert.strictEqual((await save(attemptId, student, questionId(quiz), "right")).status, 200);
      assert.strictEqual((await call("GET", `/proctoring/attempts/${attemptId}`, student)).status, 200);
      assert.strictEqual((await call("POST", `/proctoring/attempts/${attemptId}/submit`, student)).status, 200);
    });

    test("a video lease on another device blocks beginning, with no attempt used", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const otherDevice = await prisma.device.create({ data: { userId: student.id, deviceKeyHash: `lease-${quiz.id}` } });
      const otherSession = await prisma.authSession.create({ data: { userId: student.id, deviceId: otherDevice.id, tokenHash: `lease-${quiz.id}`, authMethod: "PASSWORD", expiresAt: new Date(Date.now() + 3_600_000), absoluteExpiry: new Date(Date.now() + 3_600_000) } });
      const content = await prisma.content.findUnique({ where: { quizId: quiz.id } });
      await prisma.playbackLease.create({ data: { userId: student.id, sessionId: otherSession.id, deviceId: otherDevice.id, contentId: content.id, expiresAt: new Date(Date.now() + 60_000) } });
      const res = await begin(quiz, student);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
      assert.strictEqual(await prisma.proctoredAttempt.count({ where: { quizId: quiz.id } }), 0);
    });

    test("video cannot start during an exam", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const video = await prisma.content.create({ data: { courseId: course.id, order: 900 + Math.floor(Math.random() * 9000), type: "VIDEO", title: "Video", videoUrl: "https://youtu.be/abcdefghijk" } });
      const student = await newStudent();
      await startedExam(quiz, student);
      const res = await call("POST", "/playback/start", student, { contentId: video.id });
      assert.strictEqual(res.status, 409, res.text);
      assert.strictEqual(res.json.code, "PROCTORED_EXAM_IN_PROGRESS");
    });

    test("a video playing on this device stops when the exam starts", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const created = await begin(quiz, student);
      await makeReady(created.data.attemptId);
      const session = await prisma.authSession.findFirst({ where: { userId: student.id, status: "ACTIVE" } });
      const content = await prisma.content.findUnique({ where: { quizId: quiz.id } });
      await prisma.playbackLease.create({ data: { userId: student.id, sessionId: session.id, deviceId: session.deviceId, contentId: content.id, expiresAt: new Date(Date.now() + 60_000) } });
      const started = await call("POST", `/proctoring/attempts/${created.data.attemptId}/start`, student);
      assert.strictEqual(started.status, 200, started.text);
      assert.strictEqual(await prisma.playbackLease.count({ where: { userId: student.id, status: "ACTIVE" } }), 0);
    });

    test("a result cannot be read beside a running exam", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, attempts: 2 });
      const student = await newStudent();
      const first = await startedExam(quiz, student);
      await call("POST", `/proctoring/attempts/${first}/submit`, student);
      await startedExam(quiz, student);
      const res = await call("GET", `/quizzes/${quiz.id}/result`, student);
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "PROCTORED_EXAM_IN_PROGRESS");
    });
  });

  describe("resuming", () => {
    test("a phone cannot resume an exam", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      const res = await call("POST", `/proctoring/attempts/${attemptId}/resume`, student, undefined, { "User-Agent": PHONE });
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.json.code, "DEVICE_NOT_ALLOWED");
    });

    test("a refresh on the same device gets a new token and needs no identity recheck", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      const before = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      const res = await call("POST", `/proctoring/attempts/${attemptId}/resume`, student, undefined, browser);
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.data.identityRecheckRequired, false);
      assert.ok(res.data.monitoringToken);
      const after = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      assert.strictEqual(after.tokenVersion, before.tokenVersion + 1);
      assert.strictEqual(after.deadlineAt.getTime(), before.deadlineAt.getTime(), "the clock keeps running");
    });

    test("another device must repeat the identity check, and the old device is shut out", async () => {
      const { verifyMonitorToken } = require("../src/modules/proctoring/monitorToken");
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      const beforeMove = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      const secondDevice = await h.login(student);
      assert.notStrictEqual(secondDevice.deviceKey, student.deviceKey);
      const res = await call("POST", `/proctoring/attempts/${attemptId}/resume`, secondDevice, undefined, browser);
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.data.identityRecheckRequired, true);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      assert.strictEqual(row.identityRecheckPending, true);
      assert.strictEqual(verifyMonitorToken(res.data.monitoringToken).version, beforeMove.tokenVersion + 1);

      const blocked = await call("GET", `/proctoring/attempts/${attemptId}`, secondDevice);
      assert.strictEqual(blocked.data.questions, undefined, "no questions until the recheck passes");
      assert.strictEqual(blocked.data.identityRecheckRequired, true);
      assert.strictEqual((await save(attemptId, secondDevice, questionId(quiz), "right")).json.code, "IDENTITY_RECHECK_REQUIRED");

      await prisma.proctoredAttempt.update({ where: { id: attemptId }, data: { identityRecheckPending: false } });
      assert.strictEqual((await call("GET", `/proctoring/attempts/${attemptId}`, secondDevice)).data.questions.length, 1);

      const oldRead = await call("GET", `/proctoring/attempts/${attemptId}`, student);
      assert.strictEqual(oldRead.data.questions, undefined);
      assert.strictEqual(oldRead.data.activeElsewhere, true);
      assert.strictEqual((await save(attemptId, student, questionId(quiz), "wrong", 9)).json.code, "ATTEMPT_ACTIVE_ON_ANOTHER_DEVICE");
      assert.strictEqual((await call("POST", `/proctoring/attempts/${attemptId}/submit`, student)).json.code, "ATTEMPT_ACTIVE_ON_ANOTHER_DEVICE");
    });

    test("moving during the readiness check repeats the check", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const { data } = await begin(quiz, student);
      await makeReady(data.attemptId);
      const secondDevice = await h.login(student);
      const res = await call("POST", `/proctoring/attempts/${data.attemptId}/resume`, secondDevice, undefined, browser);
      assert.strictEqual(res.status, 200, res.text);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: data.attemptId } });
      assert.strictEqual(row.identityCheck, "PENDING");
      assert.strictEqual(row.cameraSeenAt, null);
    });
  });

  describe("ending", () => {
    test("submit scores the saved answers with the LMS scorer, once", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, questionCount: 2 });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await save(attemptId, student, questionId(quiz, 0), "right");
      await save(attemptId, student, questionId(quiz, 1), "wrong");
      const results = await Promise.all([1, 2, 3].map(() => call("POST", `/proctoring/attempts/${attemptId}/submit`, student)));
      for (const r of results) assert.strictEqual(r.status, 200, r.text);
      const attempts = await prisma.quizAttempt.findMany({ where: { quizId: quiz.id, studentId: student.studentId } });
      assert.strictEqual(attempts.length, 1, "scored exactly once");
      assert.strictEqual(attempts[0].score, 1);
      assert.strictEqual(attempts[0].totalMarks, 2);
      assert.strictEqual(attempts[0].percentage, 50);
      assert.strictEqual(attempts[0].passed, true);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      assert.strictEqual(row.status, "SUBMITTED");
      assert.strictEqual(row.endReason, "SUBMITTED");
      assert.strictEqual(row.quizAttemptId, attempts[0].id);
      assert.strictEqual(await prisma.quizQuestion.count({ where: { quizId: quiz.id } }), 2);
    });

    test("nothing can be saved or read after the end", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      const late = await save(attemptId, student, questionId(quiz), "right", 5);
      assert.strictEqual(late.status, 409);
      assert.strictEqual(late.json.code, "ATTEMPT_ENDED");
      const res = await call("GET", `/proctoring/attempts/${attemptId}`, student);
      assert.strictEqual(res.data.questions, undefined);
    });

    test("an answer after the deadline closes the attempt instead of being saved", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, questionCount: 2 });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await save(attemptId, student, questionId(quiz, 0), "right");
      await prisma.proctoredAttempt.update({ where: { id: attemptId }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
      const res = await save(attemptId, student, questionId(quiz, 1), "right");
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "TIME_EXPIRED");
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
      assert.strictEqual(row.status, "EXPIRED");
      assert.strictEqual(row.quizAttempt.score, 1, "scored from what was saved in time");
    });

    test("the sweep closes overdue exams and abandons stale readiness checks with no attempt used", async () => {
      const { sweepAttempts } = require("../src/modules/proctoring/attempt.service");
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const late = await newStudent();
      const lateId = await startedExam(quiz, late);
      await save(lateId, late, questionId(quiz), "right");
      await prisma.proctoredAttempt.update({ where: { id: lateId }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
      const idle = await newStudent();
      const { data: idleAttempt } = await begin(quiz, idle);
      await prisma.proctoredAttempt.update({ where: { id: idleAttempt.attemptId }, data: { createdAt: new Date(Date.now() - 31 * 60_000) } });
      await sweepAttempts();
      const lateRow = await prisma.proctoredAttempt.findUnique({ where: { id: lateId } });
      assert.strictEqual(lateRow.status, "EXPIRED");
      const idleRow = await prisma.proctoredAttempt.findUnique({ where: { id: idleAttempt.attemptId } });
      assert.strictEqual(idleRow.status, "ABANDONED");
      assert.strictEqual(await prisma.quizAttempt.count({ where: { quizId: quiz.id, studentId: idle.studentId } }), 0);
    });

    test("the attempt limit applies, and a new attempt needs one to be left", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, attempts: 1 });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      const res = await begin(quiz, student);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.json.code, "NO_ATTEMPTS_LEFT");
      const status = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student);
      assert.strictEqual(status.data.canStart, false);
      assert.strictEqual(status.data.reason, "NO_ATTEMPTS_LEFT");
    });

    test("a terminated attempt is used, never passed, and blocks another start until a retake is approved", async () => {
      const { finalizeAttempt } = require("../src/modules/proctoring/attempt.service");
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, attempts: 3 });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await save(attemptId, student, questionId(quiz), "right");
      await finalizeAttempt(attemptId, { endReason: "TERMINATED", rule: "CONFIRMED_PROHIBITED_OBJECT", terminationReason: "Phone" });
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
      assert.strictEqual(row.status, "TERMINATED");
      assert.strictEqual(row.quizAttempt.score, 1, "the saved answers are recorded");
      assert.strictEqual(row.quizAttempt.passed, false, "never passed, whatever the score");
      const submission = await prisma.quizSubmission.findUnique({ where: { studentId_quizId: { studentId: student.studentId, quizId: quiz.id } } });
      assert.strictEqual(submission.passed, false);
      const res = await begin(quiz, student);
      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.json.code, "RETAKE_APPROVAL_REQUIRED");
    });

    test("an approved retake allows exactly one more attempt, beyond the limit", async () => {
      const { finalizeAttempt } = require("../src/modules/proctoring/attempt.service");
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, attempts: 1 });
      const student = await newStudent();
      const first = await startedExam(quiz, student);
      await finalizeAttempt(first, { endReason: "TERMINATED", rule: "CONFIRMED_PROHIBITED_OBJECT", terminationReason: "Phone" });
      await prisma.proctoringRetakeGrant.create({ data: { quizId: quiz.id, studentId: student.studentId, sourceAttemptId: first, grantedById: owner.id } });

      const second = await startedExam(quiz, student);
      assert.notStrictEqual(second, first);
      const grant = await prisma.proctoringRetakeGrant.findUnique({ where: { sourceAttemptId: first } });
      assert.ok(grant.usedAt, "the grant is marked used");
      await save(second, student, questionId(quiz), "right");
      await call("POST", `/proctoring/attempts/${second}/submit`, student);
      const attempts = await prisma.quizAttempt.findMany({ where: { quizId: quiz.id, studentId: student.studentId }, orderBy: { attemptNumber: "asc" } });
      assert.deepStrictEqual(attempts.map((a) => [a.attemptNumber, a.passed]), [[1, false], [2, true]]);
      const third = await begin(quiz, student);
      assert.strictEqual(third.status, 403);
      assert.strictEqual(third.json.code, "NO_ATTEMPTS_LEFT");
    });

    test("a clean exam with no attempts left shows the key; one with attempts left does not, even after a pass", async () => {
      const single = await h.makeQuiz(course, { proctoringEnabled: true, attempts: 1 });
      const student = await newStudent();
      const onlyTry = await startedExam(single, student);
      await save(onlyTry, student, questionId(single), "right");
      await call("POST", `/proctoring/attempts/${onlyTry}/submit`, student);
      assert.strictEqual((await call("GET", `/quizzes/${single.id}/result`, student)).data.answerKeyRevealed, true);

      const twoTries = await h.makeQuiz(course, { proctoringEnabled: true, attempts: 2 });
      const firstTry = await startedExam(twoTries, student);
      await save(firstTry, student, questionId(twoTries), "right");
      await call("POST", `/proctoring/attempts/${firstTry}/submit`, student);
      assert.strictEqual((await call("GET", `/quizzes/${twoTries.id}/result`, student)).data.answerKeyRevealed, false);
    });

    test("closing still works after the quiz is unpublished mid-exam", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await prisma.quiz.update({ where: { id: quiz.id }, data: { isPublished: false } });
      assert.strictEqual((await call("POST", `/proctoring/attempts/${attemptId}/submit`, student)).status, 200);
      assert.strictEqual((await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } })).status, "SUBMITTED");
    });

    test("the face template is deleted when the attempt ends", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await prisma.proctoringIdentityBaseline.create({ data: { attemptId, embedding: Buffer.from([1, 2, 3]), modelName: "sface", modelSha256: "x", capturedAt: new Date() } });
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      assert.strictEqual(await prisma.proctoringIdentityBaseline.count({ where: { attemptId } }), 0);
    });

    test("a flagged attempt keeps its score and goes for review; a clean one does not", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const flagged = await newStudent();
      const flaggedId = await startedExam(quiz, flagged);
      await save(flaggedId, flagged, questionId(quiz), "right");
      await prisma.proctoredAttempt.update({ where: { id: flaggedId }, data: { isFlagged: true } });
      await call("POST", `/proctoring/attempts/${flaggedId}/submit`, flagged);
      const flaggedRow = await prisma.proctoredAttempt.findUnique({ where: { id: flaggedId }, include: { quizAttempt: true } });
      assert.strictEqual(flaggedRow.status, "SUBMITTED");
      assert.strictEqual(flaggedRow.reviewState, "PENDING");
      assert.ok(flaggedRow.reviewDueAt);
      assert.strictEqual(flaggedRow.quizAttempt.passed, true);

      const clean = await newStudent();
      const cleanId = await startedExam(quiz, clean);
      await call("POST", `/proctoring/attempts/${cleanId}/submit`, clean);
      assert.strictEqual((await prisma.proctoredAttempt.findUnique({ where: { id: cleanId } })).reviewState, "NONE");
    });

    test("answers saved after the moment of termination are not scored", async () => {
      const { finalizeAttempt } = require("../src/modules/proctoring/attempt.service");
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true, questionCount: 2 });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await save(attemptId, student, questionId(quiz, 0), "right");
      await prisma.proctoredAnswer.updateMany({ where: { attemptId }, data: { savedAt: new Date(Date.now() - 60_000) } });
      await save(attemptId, student, questionId(quiz, 1), "right");
      await finalizeAttempt(attemptId, { endReason: "TERMINATED", rule: "PERSISTENT_MULTIPLE_FACES", terminationReason: "Person", terminatedAt: new Date(Date.now() - 30_000) });
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
      assert.strictEqual(row.quizAttempt.score, 1);
    });

    test("the result withholds the answer key on a proctored quiz with a review open", async () => {
      const { finalizeAttempt } = require("../src/modules/proctoring/attempt.service");
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const attemptId = await startedExam(quiz, student);
      await finalizeAttempt(attemptId, { endReason: "TERMINATED", rule: "CONFIRMED_PROHIBITED_OBJECT", terminationReason: "Phone" });
      const res = await call("GET", `/quizzes/${quiz.id}/result`, student);
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.data.answerKeyRevealed, false);
      assert.ok(!res.text.includes("correctAnswer"));
    });
  });
});
