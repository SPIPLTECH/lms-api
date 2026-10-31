/**
 * What happens after a proctored exam: completion, results, the instructor's decision, appeals,
 * reminders and evidence deletion. Real HTTP on the disposable database, with a fake AI service.
 */
const { describe, test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const DAY = 86_400_000;

describe("completion rule, as logic", () => {
  const { isQuizComplete, summarizeQuizAttempts } = require("../src/utils/itemCompletion");

  test("an ordinary quiz keeps the percentage fallback exactly as it was", () => {
    const summary = summarizeQuizAttempts([{ passed: false }], { passed: false, percentage: 90 }, 50);
    assert.strictEqual(summary.passed, true);
  });

  test("a proctored quiz does not: a high score that was never passed stays not passed", () => {
    const summary = summarizeQuizAttempts([{ passed: false }], { passed: false, percentage: 90 }, 50, { proctored: true });
    assert.strictEqual(summary.passed, false);
  });

  test("a hold keeps it incomplete even with every attempt used", () => {
    assert.strictEqual(isQuizComplete("FINAL", { attempted: true, passed: false, attemptsUsed: 1, hold: true }, 1), false);
    assert.strictEqual(isQuizComplete("FINAL", { attempted: true, passed: false, attemptsUsed: 1 }, 1), true, "without one, unchanged");
  });

  test("a pass still counts during a hold on a later attempt", () => {
    assert.strictEqual(isQuizComplete("FINAL", { attempted: true, passed: true, attemptsUsed: 2, hold: true }, 3), true);
  });

  test("an upheld ending completes the quiz even with attempts left", () => {
    assert.strictEqual(isQuizComplete("FINAL", { attempted: true, passed: false, attemptsUsed: 1, forceComplete: true }, 3), true);
  });

  test("an approved retake adds to the allowance", () => {
    assert.strictEqual(isQuizComplete("FINAL", { attempted: true, passed: false, attemptsUsed: 1, extraAttempts: 1 }, 1), false);
    assert.strictEqual(isQuizComplete("FINAL", { attempted: true, passed: false, attemptsUsed: 2, extraAttempts: 1 }, 1), true);
  });
});

describe("after a proctored exam", { skip: HAS_TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  const { createHarness } = require("./helpers/proctoringHarness");
  const { frame, startFakeAi } = require("./helpers/fakeAi");
  const h = createHarness("rev");
  const { prisma, call } = h;
  let ai;
  let owner;
  let otherInstructor;
  let admin;
  let course;
  let queue;
  let monitor;
  let evidence;
  let review;
  const browser = { "User-Agent": CHROME };

  const settle = async () => {
    await queue.analysisQueue.drain();
    await monitor.flushBuffers();
    await evidence.drain();
    await require("../src/modules/quizzes/quiz.service").flushPendingSubmissionSideEffects();
  };

  const upload = async (token, tag, type = "PERIODIC_SNAPSHOT") => {
    const form = new FormData();
    form.append("type", type);
    form.append("snapshot", new Blob([frame(tag)], { type: "image/jpeg" }), "frame.jpg");
    const res = await fetch(`${h.baseUrl()}/proctoring/monitor/snapshots`, { method: "POST", headers: { "X-Proctoring-Token": token }, body: form });
    return res.json();
  };

  const newStudent = async (target = course) => {
    const student = await h.makeUser("STUDENT", `S${Math.random().toString(36).slice(2, 7)}`);
    await h.enroll(target, student);
    return student;
  };

  const inExam = async (quiz, student) => {
    const status = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student);
    const created = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, { consent: { accepted: true, wordingVersion: status.data.consent.wordingVersion } }, browser);
    assert.strictEqual(created.status, 201, created.text);
    await upload(created.data.monitoringToken, "ONE", "PRE_EXAM_IDENTITY");
    const started = await call("POST", `/proctoring/attempts/${created.data.attemptId}/start`, student);
    assert.strictEqual(started.status, 200, started.text);
    return { attemptId: created.data.attemptId, token: started.data.monitoringToken };
  };

  const answer = (attemptId, student, quiz, value = "right", revision = 1) =>
    call("PUT", `/proctoring/attempts/${attemptId}/answers/${quiz.quizQuestions[0].questionId}`, student, { answer: value, clientRevision: revision });

  // A course with sequential learning off keeps no progress, so the completion tests
  // each get a sequential course of their own, where this quiz is the next item.
  const sequential = () => h.makeCourse(owner.id, { sequentialLearning: true });

  /** A student who scored full marks and whose exam was ended by a sustained phone. */
  const terminated = async ({ inCourse = course, ...overrides } = {}) => {
    const quiz = await h.makeQuiz(inCourse, { proctoringEnabled: true, ...overrides });
    const student = await newStudent(inCourse);
    const { attemptId, token } = await inExam(quiz, student);
    await answer(attemptId, student, quiz);
    await upload(token, "PHONE");
    await upload(token, "PHONE");
    await settle();
    assert.strictEqual((await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } })).status, "TERMINATED");
    return { quiz, student, attemptId };
  };

  /** A student who passed with full marks, flagged on the way by a single phone frame. */
  const flagged = async ({ inCourse = course, ...overrides } = {}) => {
    const quiz = await h.makeQuiz(inCourse, { proctoringEnabled: true, ...overrides });
    const student = await newStudent(inCourse);
    const { attemptId, token } = await inExam(quiz, student);
    await answer(attemptId, student, quiz);
    await upload(token, "PHONE");
    await settle();
    await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
    await settle();
    return { quiz, student, attemptId };
  };

  const clean = async (overrides = {}) => {
    const quiz = await h.makeQuiz(course, { proctoringEnabled: true, ...overrides });
    const student = await newStudent();
    const { attemptId } = await inExam(quiz, student);
    await answer(attemptId, student, quiz);
    await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
    await settle();
    return { quiz, student, attemptId };
  };

  const decide = (attemptId, who, decision, note = "Reviewed the photos and the timeline.") => call("POST", `/proctoring/reviews/${attemptId}/decision`, who, { decision, note });
  const complete = async (student, quiz) => {
    const { recomputeCourseProgress } = require("../src/utils/progressRollup");
    await recomputeCourseProgress(student.studentId, quiz.courseId);
    const content = await prisma.content.findUnique({ where: { quizId: quiz.id } });
    const row = await prisma.contentProgress.findFirst({ where: { studentId: student.studentId, contentId: content.id } });
    return Boolean(row?.completed);
  };
  const studentResult = (attemptId, student) => call("GET", `/proctoring/attempts/${attemptId}/result`, student);

  before(async () => {
    process.env.PROCTORING_ENABLED = "true";
    process.env.AI_TERMINATE_PERSIST_SECONDS = "0";
    ai = await startFakeAi();
    await h.start();
    queue = require("../src/modules/proctoring/aiQueue");
    monitor = require("../src/modules/proctoring/monitor.service");
    evidence = require("../src/modules/proctoring/evidence.service");
    review = require("../src/modules/proctoring/review.service");
    owner = await h.makeUser("INSTRUCTOR", "Owner");
    otherInstructor = await h.makeUser("INSTRUCTOR", "Other");
    admin = await h.makeUser("ADMIN", "Admin");
    course = await h.makeCourse(owner.id);
  });

  beforeEach(() => {
    ai.state.down = false;
  });

  after(async () => {
    await settle();
    await h.stop();
    await ai.stop();
  });

  describe("completion", () => {
    test("a terminated attempt with a high score is held, not complete, however few attempts remain", async () => {
      const { quiz, student } = await terminated({ attempts: 1, inCourse: await sequential() });
      assert.strictEqual(await complete(student, quiz), false);
    });

    test("uphold completes it, not passed, even with attempts left", async () => {
      const { quiz, student, attemptId } = await terminated({ attempts: 3, inCourse: await sequential() });
      assert.strictEqual(await complete(student, quiz), false, "held until the decision");
      const res = await decide(attemptId, owner, "UPHOLD");
      assert.strictEqual(res.status, 200, res.text);
      await settle();
      assert.strictEqual(await complete(student, quiz), true);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
      assert.strictEqual(row.quizAttempt.passed, false);
    });

    test("retake keeps it open until the retake is done, and a pass on the retake completes it", async () => {
      const { quiz, student, attemptId } = await terminated({ attempts: 1, inCourse: await sequential() });
      await decide(attemptId, owner, "RETAKE");
      await settle();
      assert.strictEqual(await complete(student, quiz), false);
      const second = await inExam(quiz, student);
      await answer(second.attemptId, student, quiz);
      await call("POST", `/proctoring/attempts/${second.attemptId}/submit`, student);
      await settle();
      assert.strictEqual(await complete(student, quiz), true);
    });

    test("a flagged attempt holds nothing: it counts while under review", async () => {
      const { quiz, student } = await flagged({ inCourse: await sequential() });
      assert.strictEqual(await complete(student, quiz), true);
    });

    test("void: it stops counting as a pass, and the attempt stays used", async () => {
      const { quiz, student, attemptId } = await flagged({ attempts: 2, inCourse: await sequential() });
      assert.strictEqual(await complete(student, quiz), true, "it counted until now");
      await decide(attemptId, owner, "VOID");
      await settle();
      assert.strictEqual(await complete(student, quiz), false, "one attempt remains");
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
      assert.strictEqual(row.quizAttempt.passed, false);
      assert.strictEqual(row.quizAttempt.percentage, 100, "the score is kept for the record");
      const submission = await prisma.quizSubmission.findUnique({ where: { studentId_quizId: { studentId: student.studentId, quizId: quiz.id } } });
      assert.strictEqual(submission.passed, false);
      const progress = await prisma.quizProgress.findUnique({ where: { studentId_quizId: { studentId: student.studentId, quizId: quiz.id } } });
      assert.ok(!progress || progress.completed === false);
    });

    test("retake on a flagged attempt: it stops counting as a pass, and one more attempt is allowed", async () => {
      const { quiz, student, attemptId } = await flagged({ attempts: 1, inCourse: await sequential() });
      assert.strictEqual(await complete(student, quiz), true, "it counted until now");
      assert.strictEqual((await decide(attemptId, owner, "RETAKE")).status, 200);
      await settle();
      assert.strictEqual(await complete(student, quiz), false);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
      assert.strictEqual(row.quizAttempt.passed, false);
      assert.ok(await prisma.proctoringRetakeGrant.findUnique({ where: { sourceAttemptId: attemptId } }));
      const status = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student);
      assert.strictEqual(status.data.canStart, true);
    });

    test("accept: the score and pass stand", async () => {
      const { quiz, student, attemptId } = await flagged({ inCourse: await sequential() });
      await decide(attemptId, owner, "ACCEPT");
      await settle();
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
      assert.strictEqual(row.quizAttempt.passed, true);
      assert.strictEqual(row.reviewState, "DECIDED");
      assert.strictEqual(await complete(student, quiz), true);
    });

    test("a clean proctored attempt that failed does not pass on a stale percentage", async () => {
      const inCourse = await sequential();
      const quiz = await h.makeQuiz(inCourse, { proctoringEnabled: true, attempts: 2, passingScore: 80 });
      const student = await newStudent(inCourse);
      const { attemptId } = await inExam(quiz, student);
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      await settle();
      assert.strictEqual(await complete(student, quiz), false);
    });

    test("an unticked quiz is complete by the same fallback as today", async () => {
      const inCourse = await sequential();
      const quiz = await h.makeQuiz(inCourse, { attempts: 3, passingScore: 50 });
      const student = await newStudent(inCourse);
      await prisma.quizSubmission.create({ data: { studentId: student.studentId, quizId: quiz.id, answers: [], score: 1, totalMarks: 1, percentage: 90, passed: false } });
      assert.strictEqual(await complete(student, quiz), true);
    });
  });

  describe("what the student sees", () => {
    test("each outcome is labelled, and the LMS result carries it too", async () => {
      const ended = await terminated();
      assert.strictEqual((await studentResult(ended.attemptId, ended.student)).data.outcome, "ENDED_BY_PROCTORING");
      const lmsResult = await call("GET", `/quizzes/${ended.quiz.id}/result`, ended.student);
      assert.strictEqual(lmsResult.data.proctoring.outcome, "ENDED_BY_PROCTORING");
      assert.strictEqual(lmsResult.data.proctoring.attemptId, ended.attemptId);
      assert.strictEqual(lmsResult.data.answerKeyRevealed, false);

      const review = await flagged();
      assert.strictEqual((await studentResult(review.attemptId, review.student)).data.outcome, "UNDER_REVIEW");
      assert.strictEqual((await call("GET", `/quizzes/${review.quiz.id}/result`, review.student)).data.proctoring.outcome, "UNDER_REVIEW");

      await decide(review.attemptId, owner, "VOID");
      const voided = await studentResult(review.attemptId, review.student);
      assert.strictEqual(voided.data.outcome, "VOIDED");
      assert.strictEqual(voided.data.decision.decision, "VOID");
      assert.ok(voided.data.decision.note);
      assert.strictEqual(voided.data.passed, false);
    });

    test("an ordinary quiz's result carries nothing new", async () => {
      const quiz = await h.makeQuiz(course, { attempts: 1 });
      const student = await newStudent();
      const submit = await call("POST", `/quizzes/${quiz.id}/submit`, student, { answers: [{ questionId: quiz.quizQuestions[0].questionId, answer: "right" }] });
      assert.strictEqual(submit.status, 201, submit.text);
      const res = await call("GET", `/quizzes/${quiz.id}/result`, student);
      assert.strictEqual(res.data.proctoring, undefined);
    });

    test("the student is told when a decision is made", async () => {
      const { student, attemptId } = await terminated();
      await decide(attemptId, owner, "UPHOLD");
      await settle();
      assert.ok(await prisma.notification.findFirst({ where: { userId: student.id, eventId: { startsWith: `proctoring_decision_${attemptId}` } } }));
    });

    test("the instructor is told when a review is waiting", async () => {
      const { attemptId } = await terminated();
      await settle();
      assert.ok(await prisma.notification.findFirst({ where: { userId: owner.id, eventId: `proctoring_review_${attemptId}_0` } }));
    });
  });

  describe("reviews", () => {
    test("the list shows only what needs a person, and only the caller's own courses", async () => {
      const ended = await terminated();
      const flag = await flagged();
      const untroubled = await clean();
      const list = await call("GET", "/proctoring/reviews?state=PENDING&limit=100", owner);
      assert.strictEqual(list.status, 200, list.text);
      const ids = list.data.items.map((item) => item.attemptId);
      assert.ok(ids.includes(ended.attemptId));
      assert.ok(ids.includes(flag.attemptId));
      assert.ok(!ids.includes(untroubled.attemptId));
      const row = list.data.items.find((item) => item.attemptId === ended.attemptId);
      assert.strictEqual(row.reviewReason, "TERMINATED");
      assert.ok(row.studentName);
      assert.ok(row.quizTitle);

      const other = await call("GET", "/proctoring/reviews?state=PENDING&limit=100", otherInstructor);
      assert.strictEqual(other.data.items.length, 0);
      const everyone = await call("GET", "/proctoring/reviews?state=PENDING&limit=100", admin);
      assert.ok(everyone.data.items.some((item) => item.attemptId === ended.attemptId));
      assert.strictEqual((await call("GET", "/proctoring/reviews", ended.student)).status, 403);
    });

    test("a qualifying test appears too", async () => {
      const { attemptId } = await flagged({ quizTag: "QUALIFYING" });
      const list = await call("GET", "/proctoring/reviews?state=PENDING&limit=100", owner);
      assert.ok(list.data.items.some((item) => item.attemptId === attemptId && item.quizTag === "QUALIFYING"));
    });

    test("the detail gives staff the timeline, evidence, identity and microphone; the template never", async () => {
      const { attemptId } = await terminated();
      const res = await call("GET", `/proctoring/reviews/${attemptId}`, owner);
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.data.attempt.terminationRule, "CONFIRMED_PROHIBITED_OBJECT");
      assert.ok(res.data.events.length > 0);
      assert.ok(res.data.evidence.length > 0);
      assert.ok(res.data.evidence.every((item) => item.id && item.category && !("objectKey" in item) && !("tempPath" in item)));
      assert.strictEqual(res.data.risk.level !== undefined, true);
      assert.strictEqual(typeof res.data.attempt.microphoneStatus, "string");
      assert.ok(!res.text.includes("embedding"));
      assert.strictEqual((await call("GET", `/proctoring/reviews/${attemptId}`, otherInstructor)).status, 403);
    });

    test("only the decisions that fit: a terminated attempt is Uphold or Retake, a flagged one Accept, Void or Retake", async () => {
      const ended = await terminated();
      for (const decision of ["ACCEPT", "VOID"]) {
        const res = await decide(ended.attemptId, owner, decision);
        assert.strictEqual(res.status, 400, decision);
        assert.strictEqual(res.json.code, "DECISION_NOT_ALLOWED");
      }
      const flag = await flagged();
      assert.strictEqual((await decide(flag.attemptId, owner, "UPHOLD")).json.code, "DECISION_NOT_ALLOWED");
      const untroubled = await clean();
      assert.strictEqual((await decide(untroubled.attemptId, owner, "ACCEPT")).status, 409, "nothing to review");
    });

    test("only the course's instructor or an admin decides, and it is audited", async () => {
      const { attemptId } = await terminated();
      assert.strictEqual((await decide(attemptId, otherInstructor, "UPHOLD")).status, 403);
      assert.strictEqual((await decide(attemptId, admin, "UPHOLD")).status, 200);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      assert.strictEqual(row.decidedById, admin.id);
      assert.ok(await prisma.auditEvent.findFirst({ where: { userId: admin.id, eventType: "PROCTORING_DECISION", metadata: { path: ["attemptId"], equals: attemptId } } }));
    });

    test("a decision other than Accept needs a note", async () => {
      const { attemptId } = await terminated();
      assert.strictEqual((await call("POST", `/proctoring/reviews/${attemptId}/decision`, owner, { decision: "UPHOLD" })).status, 400);
    });

    test("two people deciding at once: one decision stands", async () => {
      const { attemptId } = await terminated();
      const results = await Promise.all([decide(attemptId, owner, "UPHOLD"), decide(attemptId, admin, "RETAKE")]);
      assert.deepStrictEqual(results.map((r) => r.status).sort(), [200, 409]);
    });

    test("nothing is ever decided automatically", async () => {
      const { attemptId } = await terminated();
      await prisma.proctoredAttempt.update({ where: { id: attemptId }, data: { reviewDueAt: new Date(Date.now() - 365 * DAY) } });
      await review.reviewReminderSweep();
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      assert.strictEqual(row.reviewState, "PENDING");
      assert.strictEqual(row.decision, null);
    });
  });

  describe("reminders", () => {
    test("after 7 days undecided: the instructor is reminded and an admin told, once each", async () => {
      const { attemptId } = await terminated();
      await prisma.proctoredAttempt.update({ where: { id: attemptId }, data: { reviewDueAt: new Date(Date.now() - 1000) } });
      await review.reviewReminderSweep();
      await review.reviewReminderSweep();
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      assert.ok(row.reminderSentAt);
      assert.ok(row.escalatedAt);
      assert.strictEqual(await prisma.notification.count({ where: { userId: owner.id, eventId: `proctoring_reminder_${attemptId}_0` } }), 1);
      assert.strictEqual(await prisma.notification.count({ where: { userId: admin.id, eventId: `proctoring_escalation_${attemptId}_0` } }), 1);
    });

    test("not before 7 days, and not once decided", async () => {
      const waiting = await terminated();
      const decided = await terminated();
      await decide(decided.attemptId, owner, "UPHOLD");
      await prisma.proctoredAttempt.update({ where: { id: decided.attemptId }, data: { reviewDueAt: new Date(Date.now() - 1000) } });
      await review.reviewReminderSweep();
      assert.strictEqual((await prisma.proctoredAttempt.findUnique({ where: { id: waiting.attemptId } })).reminderSentAt, null);
      assert.strictEqual((await prisma.proctoredAttempt.findUnique({ where: { id: decided.attemptId } })).reminderSentAt, null);
    });

    test("flagged attempts get the reminder as well", async () => {
      const { attemptId } = await flagged();
      await prisma.proctoredAttempt.update({ where: { id: attemptId }, data: { reviewDueAt: new Date(Date.now() - 1000) } });
      await review.reviewReminderSweep();
      assert.ok((await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } })).escalatedAt);
    });
  });

  describe("appeals", () => {
    const appeal = (attemptId, student, reason = "My sibling walked past; I did not use a phone.") => call("POST", `/proctoring/attempts/${attemptId}/review-requests`, student, { reason });

    test("a student can ask once per decision, which reopens the review", async () => {
      const { student, attemptId } = await terminated();
      await decide(attemptId, owner, "UPHOLD");
      const before = await studentResult(attemptId, student);
      assert.strictEqual(before.data.decision.canAppeal, true);
      const res = await appeal(attemptId, student);
      assert.strictEqual(res.status, 201, res.text);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      assert.strictEqual(row.reviewState, "PENDING");
      const again = await appeal(attemptId, student);
      assert.strictEqual(again.status, 409);
      assert.strictEqual(again.json.code, "APPEAL_ALREADY_MADE");
      assert.strictEqual((await studentResult(attemptId, student)).data.decision.canAppeal, false);
      const detail = await call("GET", `/proctoring/reviews/${attemptId}`, owner);
      assert.ok(detail.data.appeals[0].reason.includes("sibling"));
    });

    test("a second decision can overturn the first, and can be asked about once more", async () => {
      const { quiz, student, attemptId } = await terminated({ attempts: 1 });
      await decide(attemptId, owner, "UPHOLD");
      await appeal(attemptId, student);
      assert.strictEqual((await decide(attemptId, owner, "RETAKE")).status, 200);
      assert.strictEqual((await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student)).data.canStart, true);
      const row = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
      assert.strictEqual(row.reviewRound, 2);
      assert.strictEqual((await appeal(attemptId, student)).status, 201);
    });

    test("overturning a Void gives the pass back; overturning a Retake takes back an unused grant", async () => {
      const voided = await flagged();
      await decide(voided.attemptId, owner, "VOID");
      await appeal(voided.attemptId, voided.student);
      await decide(voided.attemptId, owner, "ACCEPT");
      assert.strictEqual((await prisma.proctoredAttempt.findUnique({ where: { id: voided.attemptId }, include: { quizAttempt: true } })).quizAttempt.passed, true);

      const retook = await flagged();
      await decide(retook.attemptId, owner, "RETAKE");
      await appeal(retook.attemptId, retook.student);
      await decide(retook.attemptId, owner, "VOID");
      assert.strictEqual(await prisma.proctoringRetakeGrant.count({ where: { sourceAttemptId: retook.attemptId } }), 0);
    });

    test("a terminated attempt can never become a pass, whatever the appeal", async () => {
      const { student, attemptId } = await terminated();
      await decide(attemptId, owner, "UPHOLD");
      await appeal(attemptId, student);
      assert.strictEqual((await decide(attemptId, owner, "ACCEPT")).json.code, "DECISION_NOT_ALLOWED");
    });

    test("not after 30 days, not before a decision, not on an accepted result, and only their own", async () => {
      const late = await terminated();
      await decide(late.attemptId, owner, "UPHOLD");
      await prisma.proctoredAttempt.update({ where: { id: late.attemptId }, data: { decidedAt: new Date(Date.now() - 31 * DAY) } });
      const tooLate = await appeal(late.attemptId, late.student);
      assert.strictEqual(tooLate.status, 409);
      assert.strictEqual(tooLate.json.code, "APPEAL_WINDOW_CLOSED");

      const pending = await terminated();
      assert.strictEqual((await appeal(pending.attemptId, pending.student)).json.code, "NOTHING_TO_APPEAL");

      const accepted = await flagged();
      await decide(accepted.attemptId, owner, "ACCEPT");
      assert.strictEqual((await appeal(accepted.attemptId, accepted.student)).json.code, "NOTHING_TO_APPEAL");

      assert.strictEqual((await appeal(pending.attemptId, await newStudent())).status, 403);
    });

    test("an appeal not answered in 7 days reaches an admin", async () => {
      const { student, attemptId } = await terminated();
      await decide(attemptId, owner, "UPHOLD");
      await appeal(attemptId, student);
      await prisma.proctoredAttempt.update({ where: { id: attemptId }, data: { reviewDueAt: new Date(Date.now() - 1000) } });
      await review.reviewReminderSweep();
      assert.ok(await prisma.notification.findFirst({ where: { userId: admin.id, eventId: { startsWith: `proctoring_escalation_${attemptId}_` } } }));
    });
  });

  describe("evidence after a decision", () => {
    test("a closed review releases the hold, with the 30 days to appeal still covered", async () => {
      const { attemptId } = await terminated();
      const held = await prisma.proctoringEvidence.findMany({ where: { attemptId } });
      assert.ok(held.length > 0 && held.every((row) => row.reviewHold));
      await decide(attemptId, owner, "UPHOLD");
      const released = await prisma.proctoringEvidence.findMany({ where: { attemptId } });
      assert.ok(released.every((row) => !row.reviewHold));
      assert.ok(released.every((row) => row.retainUntil.getTime() > Date.now() + 29 * DAY));
    });

    test("an appeal holds it again", async () => {
      const { student, attemptId } = await terminated();
      await decide(attemptId, owner, "UPHOLD");
      await call("POST", `/proctoring/attempts/${attemptId}/review-requests`, student, { reason: "Please look again at this." });
      const held = await prisma.proctoringEvidence.findMany({ where: { attemptId } });
      assert.ok(held.every((row) => row.reviewHold));
    });

    test("an admin can delete an attempt's images once it is closed, with a reason, and it is audited", async () => {
      const remove = (attemptId, who, body = { reason: "Student's erasure request, ticket 42." }) => call("DELETE", `/proctoring/attempts/${attemptId}/evidence`, who, body);
      const { student, attemptId } = await terminated();
      assert.strictEqual((await remove(attemptId, admin)).json.code, "REVIEW_STILL_OPEN");
      await decide(attemptId, owner, "UPHOLD");
      assert.strictEqual((await remove(attemptId, owner)).status, 403);
      assert.strictEqual((await remove(attemptId, student)).status, 403);
      assert.strictEqual((await remove(attemptId, admin, {})).status, 400);
      const res = await remove(attemptId, admin);
      assert.strictEqual(res.status, 200, res.text);
      assert.ok(res.data.deleted > 0);
      assert.strictEqual(await prisma.proctoringEvidence.count({ where: { attemptId } }), 0);
      assert.ok(await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } }), "the record of the attempt stays");
      assert.ok(await prisma.auditEvent.findFirst({ where: { userId: admin.id, eventType: "PROCTORING_EVIDENCE_DELETED", metadata: { path: ["attemptId"], equals: attemptId } } }));
    });
  });

});
