/**
 * Monitoring over real HTTP against the disposable database, with a fake AI service
 * (test/helpers/fakeAi.js). AI_TERMINATE_PERSIST_SECONDS is 0 here so a test does not
 * wait out the persistence time; the pure rule tests cover the time itself.
 */
const { describe, test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

describe("exam monitoring", { skip: HAS_TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  const { createHarness } = require("./helpers/proctoringHarness");
  const { frame, startFakeAi } = require("./helpers/fakeAi");
  const h = createHarness("mon");
  const { prisma, call } = h;
  let ai;
  let owner;
  let otherInstructor;
  let admin;
  let course;
  let monitor;
  let evidence;
  let attempts;
  let queue;
  let registry;
  let aiHealth;
  const browser = { "User-Agent": CHROME };

  const settle = async () => {
    await queue.analysisQueue.drain();
    await monitor.flushBuffers();
    await evidence.drain();
  };

  const upload = async (token, tag, { type = "PERIODIC_SNAPSHOT", frameId, clientCapturedAt, body, mime = "image/jpeg" } = {}) => {
    const form = new FormData();
    form.append("type", type);
    if (frameId) form.append("frameId", frameId);
    if (clientCapturedAt) form.append("clientCapturedAt", clientCapturedAt);
    form.append("snapshot", new Blob([body ?? frame(tag)], { type: mime }), "frame.jpg");
    const res = await fetch(`${h.baseUrl()}/proctoring/monitor/snapshots`, { method: "POST", headers: token ? { "X-Proctoring-Token": token } : {}, body: form });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, data: json?.data ?? json };
  };

  const monitorCall = (method, route, token, payload) => call(method, `/proctoring/monitor/${route}`, null, payload, token ? { "X-Proctoring-Token": token } : {});

  const newStudent = async () => {
    const student = await h.makeUser("STUDENT", `S${Math.random().toString(36).slice(2, 7)}`);
    await h.enroll(course, student);
    return student;
  };

  const preparing = async (quiz, student) => {
    const status = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student);
    const created = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, { consent: { accepted: true, wordingVersion: status.data.consent.wordingVersion } }, browser);
    assert.strictEqual(created.status, 201, created.text);
    return { attemptId: created.data.attemptId, token: created.data.monitoringToken };
  };

  /** A student through the readiness check and into the exam. */
  const inExam = async (overrides = {}) => {
    const quiz = await h.makeQuiz(course, { proctoringEnabled: true, questionCount: 2, ...overrides });
    const student = await newStudent();
    const { attemptId, token } = await preparing(quiz, student);
    const identity = await upload(token, "ONE", { type: "PRE_EXAM_IDENTITY" });
    assert.strictEqual(identity.status, 200, JSON.stringify(identity.json));
    assert.strictEqual(identity.data.identityCheck, "FACE_CHECK_PASSED");
    const started = await call("POST", `/proctoring/attempts/${attemptId}/start`, student);
    assert.strictEqual(started.status, 200, started.text);
    return { quiz, student, attemptId, token: started.data.monitoringToken };
  };

  const row = (attemptId) => prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
  const events = (attemptId, eventType) => prisma.proctoringEvent.findMany({ where: { attemptId, ...(eventType && { eventType }) }, orderBy: { serverTimestamp: "asc" } });
  const flagReasons = async (attemptId) => ((await row(attemptId)).flags || []).map((f) => f.reason);

  before(async () => {
    process.env.PROCTORING_ENABLED = "true";
    process.env.AI_TERMINATE_PERSIST_SECONDS = "0";
    process.env.AI_RECHECK_SECONDS = "2";
    ai = await startFakeAi();
    await h.start();
    monitor = require("../src/modules/proctoring/monitor.service");
    evidence = require("../src/modules/proctoring/evidence.service");
    attempts = require("../src/modules/proctoring/attempt.service");
    queue = require("../src/modules/proctoring/aiQueue");
    registry = require("../src/modules/proctoring/monitorRegistry");
    aiHealth = require("../src/modules/proctoring/ai/health");
    owner = await h.makeUser("INSTRUCTOR", "Owner");
    otherInstructor = await h.makeUser("INSTRUCTOR", "Other");
    admin = await h.makeUser("ADMIN", "Admin");
    course = await h.makeCourse(owner.id);
  });

  beforeEach(() => {
    ai.state.down = false;
    aiHealth.resetAiHealthCache();
    delete process.env.AI_IDENTITY_MATCHING;
  });

  after(async () => {
    await settle();
    await h.stop();
    await ai.stop();
  });

  describe("the monitoring token", () => {
    test("no token or a bad one is refused without touching the attempt", async () => {
      assert.strictEqual((await upload(null, "ONE")).status, 401);
      assert.strictEqual((await upload("not-a-token", "ONE")).status, 401);
      assert.strictEqual((await monitorCall("POST", "heartbeat", "not-a-token", {})).status, 401);
      assert.strictEqual((await monitorCall("GET", "context", null)).status, 401);
    });

    test("a resume stops the previous tab's token", async () => {
      const { student, attemptId, token } = await inExam();
      const resumed = await call("POST", `/proctoring/attempts/${attemptId}/resume`, student, undefined, browser);
      const old = await monitorCall("POST", "heartbeat", token, {});
      assert.strictEqual(old.status, 409);
      assert.strictEqual(old.json.code, "TOKEN_SUPERSEDED");
      assert.strictEqual((await monitorCall("POST", "heartbeat", resumed.data.monitoringToken, {})).status, 200);
    });

    test("nothing is accepted after the attempt ends", async () => {
      const { student, attemptId, token } = await inExam();
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      const res = await upload(token, "ONE");
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "ATTEMPT_ENDED");
      assert.strictEqual((await monitorCall("POST", "events", token, { eventType: "TAB_HIDDEN" })).status, 409);
    });

    test("non-images and oversized files are refused", async () => {
      const { token } = await inExam();
      assert.strictEqual((await upload(token, null, { body: Buffer.from("<script>") })).status, 415);
      assert.strictEqual((await upload(token, null, { body: Buffer.alloc(3 * 1024 * 1024, 1) })).status, 413);
    });
  });

  describe("readiness", () => {
    test("a passing identity photo opens the exam, stores the template, and tells the student nothing technical", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const { attemptId, token } = await preparing(quiz, student);
      const res = await upload(token, "ONE", { type: "PRE_EXAM_IDENTITY" });
      assert.strictEqual(res.data.identityCheck, "FACE_CHECK_PASSED");
      const text = JSON.stringify(res.json);
      for (const hidden of ["score", "confidence", "embedding", "similarity", "%"]) assert.ok(!text.includes(hidden), hidden);
      const attempt = await row(attemptId);
      assert.ok(attempt.cameraSeenAt);
      assert.strictEqual(await prisma.proctoringIdentityBaseline.count({ where: { attemptId } }), 1);
      await settle();
      const kept = await prisma.proctoringEvidence.findMany({ where: { attemptId } });
      assert.deepStrictEqual(kept.map((e) => e.category), ["IDENTITY"]);
      assert.ok(!JSON.stringify(kept[0].analysis ?? {}).includes("embedding"));
    });

    test("a failed face check blocks entry; another try can pass; the failed photo is not kept", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const { attemptId, token } = await preparing(quiz, student);
      for (const tag of ["NONE", "TWO", "LOW_FACE"]) {
        const res = await upload(token, tag, { type: "PRE_EXAM_IDENTITY" });
        assert.strictEqual(res.data.identityCheck, "FACE_CHECK_FAILED", tag);
        assert.ok(res.data.message);
      }
      assert.strictEqual((await call("POST", `/proctoring/attempts/${attemptId}/start`, student)).status, 409);
      await settle();
      assert.strictEqual(await prisma.proctoringEvidence.count({ where: { attemptId } }), 0);
      assert.strictEqual(await prisma.proctoringIdentityBaseline.count({ where: { attemptId } }), 0);
      assert.strictEqual((await row(attemptId)).identityFailures, 3);
      assert.strictEqual((await upload(token, "ONE", { type: "PRE_EXAM_IDENTITY" })).data.identityCheck, "FACE_CHECK_PASSED");
      assert.strictEqual((await call("POST", `/proctoring/attempts/${attemptId}/start`, student)).status, 200);
    });

    test("monitoring down: no exam can begin and no attempt is used", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const status = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student);
      assert.strictEqual(status.data.canStart, true);
      ai.state.down = true;
      aiHealth.resetAiHealthCache();
      const refused = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, { consent: { accepted: true, wordingVersion: status.data.consent.wordingVersion } }, browser);
      assert.strictEqual(refused.status, 503);
      assert.strictEqual(refused.json.code, "PROCTORING_UNAVAILABLE");
      assert.strictEqual((await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student)).data.reason, "PROCTORING_UNAVAILABLE");
      assert.strictEqual(await prisma.proctoredAttempt.count({ where: { quizId: quiz.id } }), 0);
      assert.strictEqual(await prisma.quizAttempt.count({ where: { quizId: quiz.id } }), 0);
    });

    test("the AI failing during the check leaves it unpassed, and start refuses", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const { attemptId, token } = await preparing(quiz, student);
      ai.state.down = true;
      const res = await upload(token, "ONE", { type: "PRE_EXAM_IDENTITY" });
      assert.strictEqual(res.data.identityCheck, "NOT_ANALYSED");
      aiHealth.resetAiHealthCache();
      const start = await call("POST", `/proctoring/attempts/${attemptId}/start`, student);
      assert.ok([409, 503].includes(start.status), start.text);
      assert.strictEqual((await row(attemptId)).status, "PREPARING");
    });

    test("identity matching off: no template, no comparison, different consent wording", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const on = (await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student)).data.consent;
      process.env.AI_IDENTITY_MATCHING = "false";
      const off = (await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student)).data.consent;
      assert.notStrictEqual(on.wordingVersion, off.wordingVersion);
      assert.ok(/face template/i.test(on.text));
      assert.ok(!/face template/i.test(off.text));

      const { attemptId, token } = await preparing(quiz, student);
      const before = ai.state.identityCalls;
      assert.strictEqual((await upload(token, "ONE", { type: "PRE_EXAM_IDENTITY" })).data.identityCheck, "FACE_CHECK_PASSED");
      assert.strictEqual(ai.state.identityCalls, before);
      assert.strictEqual(await prisma.proctoringIdentityBaseline.count({ where: { attemptId } }), 0);
      assert.strictEqual((await row(attemptId)).identityMatching, false);
    });

    test("a microphone refusal is recorded, and the exam still starts with it marked", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const student = await newStudent();
      const { attemptId, token } = await preparing(quiz, student);
      await upload(token, "ONE", { type: "PRE_EXAM_IDENTITY" });
      assert.strictEqual((await monitorCall("POST", "heartbeat", token, { microphoneStatus: "REFUSED" })).status, 200);
      assert.strictEqual((await call("POST", `/proctoring/attempts/${attemptId}/start`, student)).status, 200);
      const attempt = await row(attemptId);
      assert.strictEqual(attempt.microphoneStatus, "REFUSED");
      assert.strictEqual(attempt.isFlagged, false, "a badge, not a review");
    });
  });

  describe("gaps that had to be closed", () => {
    test("the identity photo cannot be replaced during the exam", async () => {
      const { attemptId, token } = await inExam();
      const before = await prisma.proctoringIdentityBaseline.findUnique({ where: { attemptId } });
      const res = await upload(token, "OTHER", { type: "PRE_EXAM_IDENTITY" });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "IDENTITY_LOCKED");
      const after = await prisma.proctoringIdentityBaseline.findUnique({ where: { attemptId } });
      assert.deepStrictEqual(Buffer.from(after.embedding), Buffer.from(before.embedding));
    });

    test("capture time comes from the server, whatever the client says", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "PHONE", { clientCapturedAt: "2001-01-01T00:00:00.000Z" });
      await settle();
      const kept = await prisma.proctoringEvidence.findFirst({ where: { attemptId, category: "VIOLATION" } });
      assert.ok(Date.now() - kept.receivedAt.getTime() < 60_000);
      assert.strictEqual(kept.clientCapturedAt.getUTCFullYear(), 2001, "the claim is kept as a claim");
    });

    test("frames that arrive late do not count toward a run", async () => {
      const { attemptId, token } = await inExam();
      const now = Date.now();
      await upload(token, "ONE", { clientCapturedAt: new Date(now).toISOString() });
      for (let i = 0; i < 3; i += 1) {
        await upload(token, "PHONE", { clientCapturedAt: new Date(now - 300_000 - i).toISOString() });
      }
      await settle();
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
      assert.ok((await flagReasons(attemptId)).includes("FRAMES_ARRIVING_LATE"));
      const late = await prisma.proctoringEvidence.findMany({ where: { attemptId, late: true } });
      assert.strictEqual(late.length, 3);
    });

    test("stopped uploads are recorded and flagged, once per gap", async () => {
      const { attemptId } = await inExam();
      const live = registry.peek(attemptId);
      live.lastSnapshotAt = new Date(Date.now() - 120_000);
      await monitor.watchdogTick();
      await monitor.watchdogTick();
      await settle();
      assert.deepStrictEqual(await flagReasons(attemptId), ["UPLOADS_STOPPED"]);
      assert.strictEqual((await events(attemptId, "MONITORING_GAP")).length, 1);
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS", "never ended for an outage");
    });

    test("camera loss is recorded and flagged", async () => {
      const { attemptId, token } = await inExam();
      assert.strictEqual((await monitorCall("POST", "events", token, { eventType: "CAMERA_INTERRUPTED" })).status, 200);
      await settle();
      assert.ok((await flagReasons(attemptId)).includes("CAMERA_LOST"));
      assert.strictEqual((await events(attemptId, "CAMERA_INTERRUPTED")).length, 1);
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
    });
  });

  describe("exam endings", () => {
    test("a sustained phone ends the exam: attempt used, never passed, and held for review", async () => {
      const { quiz, student, attemptId, token } = await inExam({ attempts: 3 });
      await call("PUT", `/proctoring/attempts/${attemptId}/answers/${quiz.quizQuestions[0].questionId}`, student, { answer: "right", clientRevision: 1 });
      await call("PUT", `/proctoring/attempts/${attemptId}/answers/${quiz.quizQuestions[1].questionId}`, student, { answer: "right", clientRevision: 1 });
      const first = await upload(token, "PHONE");
      assert.strictEqual(first.status, 200);
      const second = await upload(token, "PHONE");
      assert.strictEqual(second.status, 200);
      await settle();

      const attempt = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
      assert.strictEqual(attempt.status, "TERMINATED");
      assert.strictEqual(attempt.terminationRule, "CONFIRMED_PROHIBITED_OBJECT");
      assert.strictEqual(attempt.reviewState, "PENDING");
      assert.strictEqual(attempt.quizAttempt.percentage, 100);
      assert.strictEqual(attempt.quizAttempt.passed, false);
      assert.ok(!/\d+%|0\.\d/.test(attempt.terminationReason), "no scores in what the student is told");
      assert.strictEqual((await events(attemptId, "AUTO_TERMINATION_ENFORCED")).length, 1);
      const kept = await prisma.proctoringEvidence.findMany({ where: { attemptId, category: "VIOLATION" } });
      assert.ok(kept.length >= 2);
      assert.ok(kept.every((e) => e.reviewHold));
      const retry = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, { consent: { accepted: true, wordingVersion: "x" } }, browser);
      assert.strictEqual(retry.status, 400);

      const after = await upload(token, "PHONE");
      assert.strictEqual(after.status, 409);
      assert.strictEqual(after.json.code, "ATTEMPT_ENDED");
    });

    test("the student is told once, by the frame or the next heartbeat, without a score", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "PHONE");
      await upload(token, "PHONE");
      await settle();
      assert.strictEqual((await row(attemptId)).status, "TERMINATED");
      const context = await monitorCall("GET", "context", token);
      assert.strictEqual(context.status, 409);
      assert.strictEqual(context.json.code, "ATTEMPT_ENDED");
    });

    test("a sustained second person ends the exam", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "TWO");
      await upload(token, "TWO");
      await settle();
      const attempt = await row(attemptId);
      assert.strictEqual(attempt.status, "TERMINATED");
      assert.strictEqual(attempt.terminationRule, "PERSISTENT_MULTIPLE_FACES");
    });

    test("a single high-confidence phone frame flags and the exam goes on", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "PHONE");
      await upload(token, "ONE");
      await settle();
      const attempt = await row(attemptId);
      assert.strictEqual(attempt.status, "IN_PROGRESS");
      assert.ok((await flagReasons(attemptId)).includes("SINGLE_HIGH_CONFIDENCE_OBJECT"));
    });

    test("a mid-confidence single phone frame only warns", async () => {
      const { attemptId, token } = await inExam();
      const res = await upload(token, "PHONE_MID");
      await upload(token, "ONE");
      await settle();
      assert.strictEqual(res.status, 200);
      assert.strictEqual((await row(attemptId)).isFlagged, false);
      assert.strictEqual((await events(attemptId, "PROHIBITED_OBJECT_DETECTED")).length, 1);
    });

    test("identity mismatch flags and never ends", async () => {
      const { attemptId, token } = await inExam();
      for (let i = 0; i < 4; i += 1) await upload(token, "OTHER");
      await settle();
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
      assert.ok((await flagReasons(attemptId)).includes("PERSISTENT_IDENTITY_MISMATCH"));
    });

    test("absence with a focus loss flags and never ends", async () => {
      const { attemptId, token } = await inExam();
      await monitorCall("POST", "events", token, { eventType: "TAB_HIDDEN" });
      for (let i = 0; i < 4; i += 1) await upload(token, "NONE");
      await settle();
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
      assert.ok((await flagReasons(attemptId)).includes("PERSISTENT_ABSENCE"));
    });

    test("a critical correlated alert flags and never ends", async () => {
      const { attemptId, token } = await inExam();
      await monitorCall("POST", "events", token, { eventType: "VOICE_ACTIVITY_DETECTED" });
      await monitorCall("POST", "events", token, { eventType: "SCREENSHOT_ATTEMPT" });
      await upload(token, "OTHER");
      await upload(token, "OTHER");
      await upload(token, "PHONE_MID");
      await settle();
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
      assert.ok((await events(attemptId, "AI_CORRELATED_ALERT")).length >= 1);
    });

    test("the warning limit flags and never ends", async () => {
      const { attemptId, token } = await inExam();
      let last;
      for (let i = 0; i < 5; i += 1) {
        registry.peek(attemptId).lastWarningAt = null;
        registry.peek(attemptId).lastSameActionAt = {};
        last = await monitorCall("POST", "events", token, { eventType: "FULLSCREEN_EXIT" });
        assert.strictEqual(last.status, 200);
      }
      assert.strictEqual(last.data.policyResult.currentWarnings, 5);
      assert.strictEqual(last.data.policyResult.terminated, false);
      await settle();
      const attempt = await row(attemptId);
      assert.strictEqual(attempt.status, "IN_PROGRESS");
      assert.ok((await flagReasons(attemptId)).includes("WARNING_LIMIT_REACHED"));
    });

    test("the AI failing mid-exam: the exam goes on, frames are kept, and it is flagged", async () => {
      const { attemptId, token } = await inExam();
      ai.state.down = true;
      for (let i = 0; i < 4; i += 1) assert.strictEqual((await upload(token, "PHONE")).status, 200);
      await settle();
      const attempt = await row(attemptId);
      assert.strictEqual(attempt.status, "IN_PROGRESS");
      assert.ok((await flagReasons(attemptId)).includes("AI_UNAVAILABLE"));
      const kept = await prisma.proctoringEvidence.findMany({ where: { attemptId, category: "UNANALYSED" } });
      assert.strictEqual(kept.length, 4);
      assert.ok(kept.every((e) => e.retainUntil.getTime() > Date.now() + 80 * 86_400_000));
      assert.strictEqual(attempt.framesSkipped ?? 0, 0, "counters flush on the minute, not per frame");
    });

    test("termination is only attempted once however many frames race", async () => {
      const { attemptId, token } = await inExam();
      await Promise.all([1, 2, 3, 4, 5, 6].map(() => upload(token, "PHONE")));
      await settle();
      assert.strictEqual((await events(attemptId, "AUTO_TERMINATION_ENFORCED")).length, 1);
      assert.strictEqual(await prisma.quizAttempt.count({ where: { proctoredAttempt: { id: attemptId } } }), 1);
    });
  });

  describe("telling the student", () => {
    test("a suspicious frame asks for a re-check; a clean one does not", async () => {
      const { token } = await inExam();
      const clean = await upload(token, "ONE");
      assert.strictEqual(clean.data.proctoring, undefined);
      const suspicious = await upload(token, "PHONE_MID");
      assert.strictEqual(suspicious.data.proctoring.recheckInMs, 2000);
    });

    test("warnings use plain words; no scores, models or AI detail", async () => {
      const { token } = await inExam();
      const res = await upload(token, "PHONE_MID");
      assert.strictEqual(res.data.proctoring.warningIssued, true);
      assert.ok(/phone/i.test(res.data.proctoring.message));
      const text = JSON.stringify(res.json);
      for (const hidden of ["score", "confidence", "similarity", "model", "0.65"]) assert.ok(!text.includes(hidden), hidden);
    });

    test("the capture interval comes from the server, and every response repeats it", async () => {
      process.env.PROCTORING_CAPTURE_INTERVAL_SECONDS = "7";
      try {
        const { token } = await inExam();
        assert.strictEqual((await upload(token, "ONE")).data.nextIntervalSeconds, 7);
        assert.strictEqual((await monitorCall("POST", "heartbeat", token, {})).data.nextIntervalSeconds, 7);
        assert.strictEqual((await monitorCall("GET", "context", token)).data.captureIntervalSeconds, 7);
      } finally {
        delete process.env.PROCTORING_CAPTURE_INTERVAL_SECONDS;
      }
    });
  });

  describe("client events", () => {
    test("clients cannot post the server's own AI events, and cannot set severity", async () => {
      const { attemptId, token } = await inExam();
      for (const eventType of ["PROHIBITED_OBJECT_DETECTED", "MULTIPLE_FACES_DETECTED", "AI_CORRELATED_ALERT", "AUTO_TERMINATION_ENFORCED"]) {
        assert.strictEqual((await monitorCall("POST", "events", token, { eventType })).status, 400, eventType);
      }
      await monitorCall("POST", "events", token, { eventType: "COPY_ATTEMPT", severity: "CRITICAL" });
      await settle();
      assert.strictEqual((await events(attemptId, "COPY_ATTEMPT"))[0].severity, "LOW");
    });

    test("a retry with the same seq, or the same action straight after, is one event", async () => {
      const { attemptId, token } = await inExam();
      const first = await monitorCall("POST", "events", token, { eventType: "FULLSCREEN_EXIT", seq: 1 });
      const retry = await monitorCall("POST", "events", token, { eventType: "FULLSCREEN_EXIT", seq: 1 });
      assert.strictEqual(first.data.deduplicated, false);
      assert.strictEqual(retry.data.deduplicated, true);
      const pair = await monitorCall("POST", "events", token, { eventType: "TAB_HIDDEN", seq: 2 });
      const blur = await monitorCall("POST", "events", token, { eventType: "WINDOW_BLUR", seq: 3 });
      assert.strictEqual(pair.data.deduplicated, false);
      assert.strictEqual(blur.data.deduplicated, true);
      await settle();
      assert.strictEqual((await events(attemptId, "FULLSCREEN_EXIT")).length, 1);
      assert.strictEqual((await events(attemptId, "WINDOW_BLUR")).length, 0);
    });

    test("clipboard text is never stored", async () => {
      const { attemptId, token } = await inExam();
      await monitorCall("POST", "events", token, { eventType: "PASTE_ATTEMPT", metadata: { pastedText: "SECRET", length: 6 } });
      await settle();
      const [event] = await events(attemptId, "PASTE_ATTEMPT");
      assert.ok(!JSON.stringify(event.metadata).includes("SECRET"));
    });

    test("events are refused before the exam starts", async () => {
      const quiz = await h.makeQuiz(course, { proctoringEnabled: true });
      const { token } = await preparing(quiz, await newStudent());
      const res = await monitorCall("POST", "events", token, { eventType: "TAB_HIDDEN" });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "MONITORING_NOT_ACTIVE");
    });
  });

  describe("identity recheck on another device", () => {
    const moved = async () => {
      const exam = await inExam();
      const second = await h.login(exam.student);
      const resumed = await call("POST", `/proctoring/attempts/${exam.attemptId}/resume`, second, undefined, browser);
      assert.strictEqual(resumed.data.identityRecheckRequired, true);
      return { ...exam, second, token: resumed.data.monitoringToken };
    };

    test("a match opens the exam on the new device, and the original photo is kept as the baseline", async () => {
      const { attemptId, second, token } = await moved();
      const before = await prisma.proctoringIdentityBaseline.findUnique({ where: { attemptId } });
      const res = await upload(token, "ONE", { type: "IDENTITY_RECHECK" });
      assert.strictEqual(res.data.identityRecheckRequired, false);
      assert.strictEqual((await call("GET", `/proctoring/attempts/${attemptId}`, second)).data.questions.length, 2);
      const after = await prisma.proctoringIdentityBaseline.findUnique({ where: { attemptId } });
      assert.deepStrictEqual(Buffer.from(after.embedding), Buffer.from(before.embedding));
    });

    test("someone else stays blocked, and it is flagged", async () => {
      const { attemptId, token } = await moved();
      const res = await upload(token, "OTHER", { type: "IDENTITY_RECHECK" });
      assert.strictEqual(res.data.identityRecheckRequired, true);
      assert.ok(res.data.message);
      assert.ok((await flagReasons(attemptId)).includes("IDENTITY_RECHECK_FAILED"));
    });

    test("an AI outage never strands the student: the exam opens and it is flagged", async () => {
      const { attemptId, token } = await moved();
      ai.state.down = true;
      const res = await upload(token, "ONE", { type: "IDENTITY_RECHECK" });
      assert.strictEqual(res.data.identityRecheckRequired, false);
      assert.ok((await flagReasons(attemptId)).includes("IDENTITY_RECHECK_UNVERIFIED"));
    });

    test("only a pending recheck accepts one", async () => {
      const { token } = await inExam();
      const res = await upload(token, "ONE", { type: "IDENTITY_RECHECK" });
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "IDENTITY_RECHECK_NOT_PENDING");
    });

    test("ordinary frames wait for the recheck", async () => {
      const { token } = await moved();
      const res = await upload(token, "ONE");
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "IDENTITY_RECHECK_REQUIRED");
    });
  });

  describe("the temp disk filling up", () => {
    const { resetDiskCheck } = require("../src/modules/proctoring/monitor.middleware");

    test("frames are refused with a retry, and the exam goes on", async () => {
      const { attemptId, token } = await inExam();
      process.env.PROCTORING_DISK_FULL_PERCENT = "0";
      resetDiskCheck();
      try {
        const res = await upload(token, "ONE");
        assert.strictEqual(res.status, 503);
        assert.strictEqual(res.json.code, "STORAGE_FULL");
        assert.strictEqual((await monitorCall("POST", "heartbeat", token, {})).status, 200, "the heartbeat still answers");
      } finally {
        delete process.env.PROCTORING_DISK_FULL_PERCENT;
        resetDiskCheck();
      }
      assert.strictEqual((await upload(token, "ONE")).status, 200);
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
    });
  });

  describe("protecting the live LMS", () => {
    test("a clean frame costs the database nothing on the normal path", async () => {
      const { measure } = require("../src/utils/requestTiming");
      const { attemptId } = await inExam();
      const live = registry.peek(attemptId);
      live.lastKeptPeriodicAt = new Date();
      const dir = path.join(process.env.PROCTORING_TEMP_DIR, attemptId);
      fs.mkdirSync(dir, { recursive: true });
      const { queries } = await measure(async () => {
        for (let i = 0; i < 10; i += 1) {
          const file = path.join(dir, `measure-${i}.jpg`);
          fs.writeFileSync(file, frame("ONE"));
          await monitor.ingestFrame(live, { path: file, mimetype: "image/jpeg", size: 10 }, { type: "PERIODIC_SNAPSHOT" }, { wait: false });
        }
        await queue.analysisQueue.drain();
        await monitor.heartbeat(live, {});
      });
      assert.strictEqual(queries, 0, "ten clean frames and a heartbeat made no database query");
      await settle();
      assert.strictEqual(await prisma.proctoringEvidence.count({ where: { attemptId, category: "PERIODIC" } }), 0);
    });

    test("the token check reads the database at most once per attempt", async () => {
      const { attemptId, token } = await inExam();
      registry.clear();
      const res = await monitorCall("POST", "heartbeat", token, {});
      assert.strictEqual(res.status, 200);
      assert.ok(registry.peek(attemptId));
      const timing = res.headers.get("server-timing") || "";
      assert.match(timing, /"[0-2] queries"/, timing);
      const again = await monitorCall("POST", "heartbeat", token, {});
      assert.match(again.headers.get("server-timing") || "", /"0 queries"/);
    });

    test("counters from many attempts flush in one statement", async () => {
      const { measure } = require("../src/utils/requestTiming");
      const exams = [await inExam(), await inExam(), await inExam()];
      for (const exam of exams) await upload(exam.token, "ONE");
      await settle();
      const { queries } = await measure(() => monitor.flushCounters());
      assert.strictEqual(queries, 1);
      for (const exam of exams) {
        const attempt = await row(exam.attemptId);
        assert.strictEqual(attempt.framesReceived, 1);
        assert.strictEqual(attempt.framesAnalysed, 1);
        assert.ok(attempt.lastSnapshotAt);
        assert.ok(Math.abs(attempt.lastSnapshotAt.getTime() - Date.now()) < 60_000, "stored in UTC");
      }
      const { queries: idle } = await measure(() => monitor.flushCounters());
      assert.strictEqual(idle, 0, "nothing new, nothing written");
    });

    test("one frame a minute is kept on a clean attempt, for 7 days", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "ONE");
      await upload(token, "ONE");
      await settle();
      const kept = await prisma.proctoringEvidence.findMany({ where: { attemptId, category: "PERIODIC" } });
      assert.strictEqual(kept.length, 1);
      const days = (kept[0].retainUntil.getTime() - Date.now()) / 86_400_000;
      assert.ok(days > 6.9 && days <= 7, String(days));
      assert.strictEqual(kept[0].reviewHold, false);
    });

    test("a restart of the API: monitors reload, the count carries on, and runs start again", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "PHONE");
      await settle();
      await monitor.flushCounters();
      const beforeWarnings = (await row(attemptId)).warningCount;
      assert.ok(beforeWarnings >= 1);
      registry.clear();
      await upload(token, "PHONE");
      await settle();
      const attempt = await row(attemptId);
      assert.strictEqual(attempt.status, "IN_PROGRESS", "a new process errs toward not ending the exam");
      assert.strictEqual(registry.peek(attemptId).warningCount >= beforeWarnings, true);
    });

    test("recovery after a crash: frames left on disk are kept as unanalysed evidence", async () => {
      const { attemptId } = await inExam();
      const dir = path.join(process.env.PROCTORING_TEMP_DIR, attemptId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "left-behind.jpg"), frame("ONE"));
      registry.clear();
      const recovered = await monitor.recoverAfterRestart();
      await settle();
      assert.ok(recovered.monitors >= 1);
      assert.ok(registry.peek(attemptId));
      const kept = await prisma.proctoringEvidence.findMany({ where: { attemptId, category: "UNANALYSED" } });
      assert.strictEqual(kept.length, 1);
    });

    test("admins can see the queue's health; nobody else can", async () => {
      const student = await newStudent();
      assert.strictEqual((await call("GET", "/proctoring/health", student)).status, 403);
      const res = await call("GET", "/proctoring/health", admin);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(typeof res.data.queue.backlog, "number");
      assert.strictEqual(res.data.ai.reachable, true);
      assert.ok(!res.text.includes(process.env.AI_SERVICE_TOKEN));
      assert.ok(!res.text.includes(process.env.AI_SERVICE_URL));
    });
  });

  describe("seeing evidence", () => {
    const keptImage = async () => {
      const exam = await inExam();
      await upload(exam.token, "PHONE");
      await upload(exam.token, "ONE");
      await settle();
      const kept = await prisma.proctoringEvidence.findFirst({ where: { attemptId: exam.attemptId, category: "VIOLATION" }, orderBy: { receivedAt: "asc" } });
      assert.strictEqual(kept.storageState, "STORED");
      return { ...exam, kept };
    };
    const file = (id, who) => fetch(`${h.baseUrl()}/proctoring/evidence/${id}/file`, { headers: who ? { Authorization: `Bearer ${who.token}`, "X-Device-Key": who.deviceKey } : {} });

    test("encrypted at rest, and the temp copy is gone", async () => {
      const { kept } = await keptImage();
      const stored = fs.readFileSync(path.join(process.env.PROCTORING_LOCAL_STORE_DIR, ...kept.objectKey.split("/")));
      assert.ok(!stored.includes(frame("PHONE")));
      assert.ok(!stored.includes(Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
      assert.strictEqual(kept.tempPath, null);
    });

    test("the student sees their own, the course's instructor and admins see it and are audited", async () => {
      const { student, kept } = await keptImage();
      const mine = await file(kept.id, student);
      assert.strictEqual(mine.status, 200);
      assert.deepStrictEqual(Buffer.from(await mine.arrayBuffer()), frame("PHONE"));
      assert.strictEqual(mine.headers.get("cache-control"), "private, no-store");
      assert.strictEqual(mine.headers.get("content-type"), "image/jpeg");
      const viewed = () => prisma.auditEvent.count({ where: { eventType: "PROCTORING_EVIDENCE_VIEWED", metadata: { path: ["evidenceId"], equals: kept.id } } });
      assert.strictEqual(await viewed(), 0, "a student viewing their own is not a staff view");
      assert.strictEqual((await file(kept.id, owner)).status, 200);
      assert.strictEqual((await file(kept.id, admin)).status, 200);
      assert.strictEqual(await viewed(), 2);
    });

    test("nobody else", async () => {
      const { kept } = await keptImage();
      assert.strictEqual((await file(kept.id, null)).status, 401);
      assert.strictEqual((await file(kept.id, await newStudent())).status, 403);
      assert.strictEqual((await file(kept.id, otherInstructor)).status, 403);
    });

    test("the images are never reachable through the LMS file routes", async () => {
      const { kept, student } = await keptImage();
      const res = await fetch(`${h.baseUrl()}/uploads/${kept.objectKey}`, { headers: { Authorization: `Bearer ${student.token}`, "X-Device-Key": student.deviceKey } });
      assert.notStrictEqual(res.status, 200);
    });

    test("an image past its retention date is gone, even before the sweep reaches it", async () => {
      const { student, kept } = await keptImage();
      await prisma.proctoringEvidence.update({ where: { id: kept.id }, data: { retainUntil: new Date(Date.now() - 1000), reviewHold: false } });
      const res = await file(kept.id, student);
      assert.strictEqual(res.status, 410);
      assert.strictEqual((await res.json()).code, "EVIDENCE_EXPIRED");
    });

    test("a held image past its date can still be seen", async () => {
      const { student, kept } = await keptImage();
      await prisma.proctoringEvidence.update({ where: { id: kept.id }, data: { retainUntil: new Date(Date.now() - 1000), reviewHold: true } });
      assert.strictEqual((await file(kept.id, student)).status, 200);
    });

    test("if the staff view cannot be audited, no image is sent", async (t) => {
      const { kept } = await keptImage();
      const audit = require("../src/modules/audit/audit.service");
      t.mock.method(audit, "recordAuditEvent", async () => {
        throw new Error("audit table unavailable");
      });
      const res = await file(kept.id, owner);
      assert.strictEqual(res.status, 503);
      assert.strictEqual((await res.json()).code, "EVIDENCE_AUDIT_FAILED");
    });

    test("a store outage keeps the frame on disk and marks it for another try", async () => {
      const exam = await inExam();
      const realStore = evidence.setStoreForTests({ put: async () => { throw new Error("store down"); } });
      try {
        await upload(exam.token, "PHONE");
        await upload(exam.token, "ONE");
        await settle();
      } finally {
        evidence.setStoreForTests(realStore);
      }
      const kept = await prisma.proctoringEvidence.findFirst({ where: { attemptId: exam.attemptId, category: "VIOLATION" } });
      assert.strictEqual(kept.storageState, "FAILED");
      assert.ok(fs.existsSync(kept.tempPath));
      assert.strictEqual((await file(kept.id, exam.student)).status, 200, "still viewable");
      const { retentionSweep } = require("../src/modules/proctoring/retention.service");
      await retentionSweep();
      await settle();
      const retried = await prisma.proctoringEvidence.findUnique({ where: { id: kept.id } });
      assert.strictEqual(retried.storageState, "STORED");
    });
  });

  describe("retention", () => {
    const { retentionSweep } = require("../src/modules/proctoring/retention.service");
    const past = new Date(Date.now() - 60_000);

    test("the sweep removes expired frames from the store, not held ones", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "PHONE");
      await upload(token, "ONE");
      await settle();
      const kept = await prisma.proctoringEvidence.findMany({ where: { attemptId }, orderBy: { receivedAt: "asc" } });
      assert.ok(kept.length >= 2);
      const [expired, held] = kept;
      await prisma.proctoringEvidence.update({ where: { id: expired.id }, data: { retainUntil: past, reviewHold: false } });
      await prisma.proctoringEvidence.update({ where: { id: held.id }, data: { retainUntil: past, reviewHold: true } });
      const objectFile = path.join(process.env.PROCTORING_LOCAL_STORE_DIR, ...expired.objectKey.split("/"));
      assert.ok(fs.existsSync(objectFile));

      const result = await retentionSweep();
      assert.ok(result.deleted >= 1);
      assert.strictEqual(await prisma.proctoringEvidence.count({ where: { id: expired.id } }), 0);
      assert.strictEqual(fs.existsSync(objectFile), false);
      assert.strictEqual(await prisma.proctoringEvidence.count({ where: { id: held.id } }), 1, "a review hold outlasts the date");
      assert.ok(await prisma.auditEvent.findFirst({ where: { eventType: "PROCTORING_RETENTION_SWEEP" } }));
    });

    test("flagging holds what was already kept, for 90 days or until review closes", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "ONE");
      await settle();
      const clean = await prisma.proctoringEvidence.findFirst({ where: { attemptId, category: "PERIODIC" } });
      assert.strictEqual(clean.reviewHold, false);
      await upload(token, "PHONE");
      await settle();
      const held = await prisma.proctoringEvidence.findUnique({ where: { id: clean.id } });
      assert.strictEqual(held.reviewHold, true);
      assert.ok(held.retainUntil.getTime() > Date.now() + 80 * 86_400_000);
    });

    test("detection frames go when the attempt closes; nothing is left on disk", async () => {
      const { student, attemptId, token } = await inExam();
      await upload(token, "ONE");
      await upload(token, "ONE");
      await settle();
      const dir = path.join(process.env.PROCTORING_TEMP_DIR, attemptId);
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      await settle();
      const remaining = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      assert.deepStrictEqual(remaining, []);
    });

    test("the sweep clears the temp folders of closed attempts, even with no monitor in memory", async () => {
      const { student, attemptId } = await inExam();
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      await settle();
      const dir = path.join(process.env.PROCTORING_TEMP_DIR, attemptId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "stale.jpg"), frame("ONE"));
      await retentionSweep();
      assert.strictEqual(fs.existsSync(dir), false);
    });

    test("the sweep removes face templates of ended attempts it finds", async () => {
      const { student, attemptId } = await inExam();
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      await prisma.proctoringIdentityBaseline.create({ data: { attemptId, embedding: Buffer.from([1]), modelName: "m", modelSha256: "s", capturedAt: new Date() } });
      await retentionSweep();
      assert.strictEqual(await prisma.proctoringIdentityBaseline.count({ where: { attemptId } }), 0);
    });
  });

  describe("the exam-ended view", () => {
    const result = (attemptId, who) => call("GET", `/proctoring/attempts/${attemptId}/result`, who);
    const HIDDEN = ["confidence", "signalConfidence", "similarity", "embedding", "analysis", "objectKey", "tempPath", "flags", "reviewReason"];

    test("ended by proctoring: the reason, the score, never passed, evidence the student can open, no scores from the AI", async () => {
      const { quiz, student, attemptId, token } = await inExam();
      await call("PUT", `/proctoring/attempts/${attemptId}/answers/${quiz.quizQuestions[0].questionId}`, student, { answer: "right", clientRevision: 1 });
      await monitorCall("POST", "events", token, { eventType: "FULLSCREEN_EXIT" });
      await upload(token, "PHONE");
      await upload(token, "PHONE");
      await settle();
      const res = await result(attemptId, student);
      assert.strictEqual(res.status, 200, res.text);
      assert.strictEqual(res.data.outcome, "ENDED_BY_PROCTORING");
      assert.strictEqual(res.data.endedBy, "PROCTORING");
      assert.ok(/phone/i.test(res.data.reason));
      assert.strictEqual(res.data.score, 1);
      assert.strictEqual(res.data.totalMarks, 2);
      assert.strictEqual(res.data.passed, false);
      assert.strictEqual(res.data.identityCheck, "FACE_CHECK_PASSED");
      assert.ok(res.data.warningCount >= 1);
      assert.strictEqual(res.data.telemetry.framesReceived, 2);
      assert.strictEqual(res.data.quiz.title, quiz.title);
      assert.strictEqual(res.data.answers.length, 2);
      assert.strictEqual(res.data.answers.filter((a) => a.saved).length, 1);
      assert.ok(res.data.answers.every((a) => !("correctAnswer" in a)));
      for (const word of HIDDEN) assert.ok(!res.text.includes(word), word);

      const types = res.data.violations.map((v) => v.eventType);
      assert.ok(types.includes("FULLSCREEN_EXIT"));
      assert.ok(types.includes("PROHIBITED_OBJECT_DETECTED"));
      assert.ok(types.includes("AUTO_TERMINATION_ENFORCED"));
      assert.ok(!types.includes("ATTEMPT_FLAGGED"), "review detail is for staff");
      const phone = res.data.violations.find((v) => v.eventType === "PROHIBITED_OBJECT_DETECTED");
      assert.ok(phone.explanation);
      assert.ok(phone.evidenceId, "the frame is attached");
      const image = await fetch(`${h.baseUrl()}/proctoring/evidence/${phone.evidenceId}/file`, { headers: { Authorization: `Bearer ${student.token}`, "X-Device-Key": student.deviceKey } });
      assert.strictEqual(image.status, 200);
      assert.strictEqual(res.data.violations.find((v) => v.eventType === "FULLSCREEN_EXIT").warningNumber, 1);
    });

    test("flagged: the score stands, marked under review, and the student is not told why", async () => {
      const { quiz, student, attemptId, token } = await inExam();
      await call("PUT", `/proctoring/attempts/${attemptId}/answers/${quiz.quizQuestions[0].questionId}`, student, { answer: "right", clientRevision: 1 });
      await upload(token, "PHONE");
      await settle();
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      const res = await result(attemptId, student);
      assert.strictEqual(res.data.outcome, "UNDER_REVIEW");
      assert.strictEqual(res.data.endedBy, "STUDENT");
      assert.strictEqual(res.data.passed, true);
      assert.strictEqual(res.data.percentage, 50);
      assert.strictEqual(res.data.reason, null);
      for (const word of HIDDEN) assert.ok(!res.text.includes(word), word);
    });

    test("clean: an ordinary result; time running out says so", async () => {
      const clean = await inExam();
      await call("POST", `/proctoring/attempts/${clean.attemptId}/submit`, clean.student);
      const cleanResult = await result(clean.attemptId, clean.student);
      assert.strictEqual(cleanResult.data.outcome, "SCORED");
      assert.strictEqual(cleanResult.data.endedBy, "STUDENT");

      const late = await inExam();
      await prisma.proctoredAttempt.update({ where: { id: late.attemptId }, data: { deadlineAt: new Date(Date.now() - 60_000) } });
      await attempts.sweepAttempts();
      assert.strictEqual((await result(late.attemptId, late.student)).data.endedBy, "TIME");
    });

    test("only after the end, and only the student's own", async () => {
      const { student, attemptId } = await inExam();
      const running = await result(attemptId, student);
      assert.strictEqual(running.status, 409);
      assert.strictEqual(running.json.code, "ATTEMPT_NOT_ENDED");
      assert.strictEqual((await result(attemptId, await newStudent())).status, 403);
    });
  });
});
