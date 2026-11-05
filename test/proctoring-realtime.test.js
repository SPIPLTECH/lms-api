/**
 * How quickly a decision reaches the student, over real HTTP against the disposable database with
 * a fake AI. An upload must not wait for the AI, and a warning must not wait for the database.
 */
const { describe, test, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

describe("exam monitoring, in real time", { skip: HAS_TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  const { createHarness } = require("./helpers/proctoringHarness");
  const { frame, startFakeAi } = require("./helpers/fakeAi");
  const h = createHarness("rt");
  const { prisma, call } = h;
  let ai;
  let owner;
  let course;
  let attempts;
  let evidence;
  let monitor;
  let queue;
  let registry;
  const browser = { "User-Agent": CHROME };

  const settle = async () => {
    await queue.analysisQueue.drain();
    await monitor.flushBuffers();
    await evidence.drain();
  };

  const upload = async (token, tag, { type = "PERIODIC_SNAPSHOT" } = {}) => {
    const form = new FormData();
    form.append("type", type);
    form.append("snapshot", new Blob([frame(tag)], { type: "image/jpeg" }), "frame.jpg");
    const res = await fetch(`${h.baseUrl()}/proctoring/monitor/snapshots`, { method: "POST", headers: { "X-Proctoring-Token": token }, body: form });
    const json = await res.json().catch(() => null);
    return { status: res.status, json, data: json?.data ?? json };
  };

  const monitorCall = (method, route, token, payload) => call(method, `/proctoring/monitor/${route}`, null, payload, { "X-Proctoring-Token": token });
  const notices = (token, after) => monitorCall("GET", after === undefined ? "notices" : `notices?after=${after}`, token);

  /** A student through the readiness check, stopping before Start. */
  const readyToStart = async () => {
    const quiz = await h.makeQuiz(course, { proctoringEnabled: true, questionCount: 2 });
    const student = await h.makeUser("STUDENT", `S${Math.random().toString(36).slice(2, 7)}`);
    await h.enroll(course, student);
    const status = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student);
    const created = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, { consent: { accepted: true, wordingVersion: status.data.consent.wordingVersion } }, browser);
    assert.strictEqual(created.status, 201, created.text);
    const photo = await upload(created.data.monitoringToken, "ONE", { type: "PRE_EXAM_IDENTITY" });
    assert.strictEqual(photo.data.identityCheck, "FACE_CHECK_PASSED");
    return { quiz, student, attemptId: created.data.attemptId };
  };

  const inExam = async () => {
    const ready = await readyToStart();
    const started = await call("POST", `/proctoring/attempts/${ready.attemptId}/start`, ready.student);
    assert.strictEqual(started.status, 200, started.text);
    return { ...ready, token: started.data.monitoringToken };
  };

  const row = (attemptId) => prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
  const events = (attemptId, eventType) => prisma.proctoringEvent.findMany({ where: { attemptId, ...(eventType && { eventType }) }, orderBy: { serverTimestamp: "asc" } });

  /** Polls until the channel has something, the way the exam page does. */
  const nextNotices = async (token, after) => {
    for (let tries = 0; tries < 40; tries += 1) {
      const res = await notices(token, after);
      assert.strictEqual(res.status, 200, res.text);
      if (res.data.notices.length > 0) return res.data;
      after = res.data.cursor;
    }
    throw new Error("No notice arrived.");
  };

  const earn = async (attemptId, token, count) => {
    const seen = [];
    let { data: { cursor } } = await notices(token);
    for (let i = 0; i < count; i += 1) {
      registry.peek(attemptId).lastWarningAt = null;
      registry.peek(attemptId).activeEpisodes.clear();
      registry.peek(attemptId).emittedRuns.clear();
      assert.strictEqual((await upload(token, "PHONE_MID")).status, 200);
      const got = await nextNotices(token, cursor);
      cursor = got.cursor;
      seen.push(...got.notices);
      // The last job may be held on purpose, so only the ones before it are waited for.
      if (i < count - 1) await queue.analysisQueue.drain();
    }
    return seen;
  };

  before(async () => {
    // What production runs: uploads do not wait for the AI.
    process.env.AI_UPLOAD_WAIT_MS = "0";
    process.env.PROCTORING_ENABLED = "true";
    process.env.AI_TERMINATE_PERSIST_SECONDS = "3600";
    process.env.AI_HEAD_POSE_SUSTAINED_SECONDS = "0";
    process.env.AI_FACE_ABSENT_SUSTAINED_SECONDS = "0";
    process.env.AI_RECHECK_SECONDS = "2";
    process.env.PROCTORING_NOTICE_HOLD_SECONDS = "1";
    ai = await startFakeAi();
    await h.start();
    attempts = require("../src/modules/proctoring/attempt.service");
    evidence = require("../src/modules/proctoring/evidence.service");
    monitor = require("../src/modules/proctoring/monitor.service");
    queue = require("../src/modules/proctoring/aiQueue");
    registry = require("../src/modules/proctoring/monitorRegistry");
    owner = await h.makeUser("INSTRUCTOR", "Owner");
    course = await h.makeCourse(owner.id);
  });

  beforeEach(() => {
    ai.state.delayMs = 0;
    ai.state.down = false;
  });

  after(async () => {
    await settle();
    await h.stop();
    await ai.stop();
  });

  describe("an upload does not wait for the AI", () => {
    test("it answers while the AI is still working, and the frame is still analysed", async () => {
      const { attemptId, token } = await inExam();
      ai.state.delayMs = 500;
      const before = ai.state.calls;
      const at = Date.now();
      const res = await upload(token, "ONE");
      const took = Date.now() - at;
      assert.strictEqual(res.status, 200);
      assert.ok(res.data.frameId);
      assert.strictEqual(res.data.proctoring, undefined);
      assert.ok(took < 400, `The upload took ${took} ms with an AI that takes 500 ms.`);
      await queue.analysisQueue.drain();
      assert.strictEqual(ai.state.calls, before + 1);
      assert.strictEqual(registry.peek(attemptId).framesAnalysed, 1);
    });

    test("uploads that arrive together are all analysed", async () => {
      const { attemptId, token } = await inExam();
      await Promise.all([1, 2, 3, 4].map(() => upload(token, "ONE")));
      await queue.analysisQueue.drain();
      assert.strictEqual(registry.peek(attemptId).framesReceived, 4);
      assert.strictEqual(registry.peek(attemptId).framesAnalysed, 4);
    });
  });

  describe("the notice channel", () => {
    test("with no cursor it answers at once with where things stand, and replays nothing", async () => {
      const { token } = await inExam();
      await earnNothing(token);
      const at = Date.now();
      const res = await notices(token);
      assert.strictEqual(res.status, 200);
      assert.ok(Date.now() - at < 500);
      assert.deepStrictEqual(res.data.notices, []);
      assert.strictEqual(typeof res.data.cursor, "number");
      assert.strictEqual(res.data.currentWarnings, 0);
      assert.strictEqual(res.data.maxWarnings, 3);
    });

    const earnNothing = async (token) => assert.strictEqual((await upload(token, "ONE")).status, 200);

    test("a waiting request gets a warning as soon as the AI has decided, in plain words", async () => {
      const { token } = await inExam();
      const { data: { cursor } } = await notices(token);
      const waiting = notices(token, cursor);
      const at = Date.now();
      await upload(token, "PHONE_MID");
      const { status, data, text } = await waiting;
      assert.strictEqual(status, 200, text);
      assert.ok(Date.now() - at < 900, "Held to the end of the wait rather than woken.");
      assert.strictEqual(data.notices.length, 1);
      const [notice] = data.notices;
      assert.strictEqual(notice.warningIssued, true);
      assert.strictEqual(notice.currentWarnings, 1);
      assert.strictEqual(notice.terminated, false);
      assert.ok(/phone/i.test(notice.message));
      assert.ok(data.cursor >= notice.id);
      assert.deepStrictEqual(data.activeConditions, ["PROHIBITED_OBJECT_DETECTED"]);
      for (const hidden of ["score", "confidence", "similarity", "model", "0.65"]) assert.ok(!text.includes(hidden), hidden);
    });

    test("with nothing to say it answers empty when the wait is over", async () => {
      const { token } = await inExam();
      const { data: { cursor } } = await notices(token);
      const at = Date.now();
      const res = await notices(token, cursor);
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.data.notices, []);
      assert.strictEqual(res.data.cursor, cursor);
      assert.ok(Date.now() - at >= 900, "It answered without waiting.");
    });

    test("a notice is delivered once per cursor, and a late heartbeat carries the same id", async () => {
      const { token } = await inExam();
      const start = (await notices(token)).data.cursor;
      await upload(token, "PHONE_MID");
      const first = await nextNotices(token, start);
      await queue.analysisQueue.drain();
      const later = await notices(token, first.cursor);
      assert.deepStrictEqual(later.data.notices, []);
      const beat = await monitorCall("POST", "heartbeat", token, {});
      assert.strictEqual(beat.data.proctoring.id, first.notices[0].id, "Lets the page ignore the copy it already showed.");
    });

    test("a suspicious frame asks for a re-check through the channel", async () => {
      const { token } = await inExam();
      const start = (await notices(token)).data.cursor;
      await upload(token, "PHONE_BORDERLINE");
      const { notices: [notice] } = await nextNotices(token, start);
      assert.strictEqual(notice.warningIssued, false);
      assert.strictEqual(notice.recheckInMs, 2000);
    });

    test("a problem confirmed inside the gap after a warning is postponed, not dropped", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "PHONE_MID");
      await queue.analysisQueue.drain();
      assert.strictEqual(registry.peek(attemptId).warningCount, 1);

      // Within the 5 s gap: the no-face rule is met. It is recorded for review, but its warning waits.
      await upload(token, "NONE");
      await upload(token, "NONE");
      await queue.analysisQueue.drain();
      // Events reach the database in batches, so the attempt's own list is read.
      const absences = () => registry.peek(attemptId).events.filter((event) => event.eventType === "FACE_NOT_DETECTED");
      assert.deepStrictEqual(absences().map((event) => event.warningIssued), [false]);
      assert.strictEqual(registry.peek(attemptId).warningCount, 1);

      // Still inside the gap: still waiting, and recorded only once.
      await upload(token, "NONE");
      await queue.analysisQueue.drain();
      assert.deepStrictEqual(absences().map((event) => event.warningIssued), [false]);

      // The gap is over and the camera is still covered: the next photo earns the warning it was owed.
      registry.peek(attemptId).lastWarningAt = new Date(Date.now() - 6000);
      await upload(token, "NONE");
      await queue.analysisQueue.drain();
      const [seen, warned] = absences();
      assert.ok(warned, "the warning came once the gap was over");
      assert.strictEqual(warned.warningIssued, true);
      assert.strictEqual(warned.metadata.postponedFrom, seen.id, "linked to the record it was owed for");
      assert.strictEqual(registry.peek(attemptId).warningCount, 2);

      // Owed once: the camera staying covered earns nothing more.
      registry.peek(attemptId).lastWarningAt = new Date(Date.now() - 6000);
      await upload(token, "NONE");
      await queue.analysisQueue.drain();
      assert.strictEqual(absences().length, 2);
      assert.strictEqual(registry.peek(attemptId).warningCount, 2);
    });

    test("a problem that clears inside the gap is recorded and never warned for", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "PHONE_MID");
      await upload(token, "NONE");
      await upload(token, "NONE");
      await upload(token, "ONE");
      await upload(token, "ONE");
      await queue.analysisQueue.drain();
      registry.peek(attemptId).lastWarningAt = new Date(Date.now() - 6000);
      await upload(token, "ONE");
      await queue.analysisQueue.drain();
      const absences = registry.peek(attemptId).events.filter((event) => event.eventType === "FACE_NOT_DETECTED");
      assert.deepStrictEqual(absences.map((event) => event.warningIssued), [false]);
      assert.strictEqual(registry.peek(attemptId).warningCount, 1);
    });

    test("a condition ending wakes the channel, so the ongoing banner can close", async () => {
      const { token } = await inExam();
      await upload(token, "PHONE_MID");
      await queue.analysisQueue.drain();
      let { data: { cursor, activeConditions } } = await notices(token);
      assert.deepStrictEqual(activeConditions, ["PROHIBITED_OBJECT_DETECTED"]);
      const waiting = notices(token, cursor);
      await upload(token, "ONE");
      const { data } = await waiting;
      assert.deepStrictEqual(data.activeConditions, []);
      assert.ok(data.cursor > cursor);
      cursor = data.cursor;
    });

    test("needs the attempt's token, and refuses one that has been replaced", async () => {
      const { student, attemptId, token } = await inExam();
      assert.strictEqual((await notices("not-a-token")).status, 401);
      await call("POST", `/proctoring/attempts/${attemptId}/resume`, student, undefined, browser);
      const old = await notices(token);
      assert.strictEqual(old.status, 409);
      assert.strictEqual(old.json.code, "TOKEN_SUPERSEDED");
    });

    test("a request waiting when the student submits is told the exam ended, once the figures are written", async () => {
      const { student, attemptId, token } = await inExam();
      await upload(token, "ONE");
      await queue.analysisQueue.drain();
      let { data: { cursor } } = await notices(token);
      const waiting = notices(token, cursor).then(async (res) => ({ res, framesWhenTold: (await row(attemptId)).framesReceived }));
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      const { res, framesWhenTold } = await waiting;
      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.json.code, "ATTEMPT_ENDED");
      assert.strictEqual(framesWhenTold, 1, "The page reads the result straight after this, so its figures must be there.");
    });

    test("warnings keep their order and their count when several events race", async () => {
      process.env.AI_FACE_ABSENT_SUSTAINED_SECONDS = "0";
      const { attemptId, token } = await inExam();
      const start = (await notices(token)).data.cursor;
      const types = ["FULLSCREEN_EXIT", "COPY_ATTEMPT", "PASTE_ATTEMPT", "CUT_ATTEMPT", "CONTEXT_MENU", "TAB_HIDDEN"];
      const responses = await Promise.all(types.map((eventType) => monitorCall("POST", "events", token, { eventType })));
      assert.ok(responses.every((res) => res.status === 200 || res.json?.code === "ATTEMPT_ENDED"));
      const issued = responses.filter((res) => res.data?.policyResult?.warningIssued);
      assert.strictEqual(issued.length, registry.peek(attemptId).warningCount);
      const { notices: delivered } = await nextNotices(token, start);
      const ids = delivered.map((item) => item.id);
      assert.deepStrictEqual(ids, [...new Set(ids)].sort((a, b) => a - b));
      const counts = delivered.filter((item) => item.warningIssued).map((item) => item.currentWarnings);
      assert.deepStrictEqual(counts, [...counts].sort((a, b) => a - b));
      assert.strictEqual(new Set(counts).size, counts.length, "The same warning number twice.");
    });
  });

  describe("ending an exam", () => {
    let originalFinalize;
    beforeEach(() => {
      originalFinalize = attempts.finalizeAttempt;
    });
    afterEach(() => {
      attempts.finalizeAttempt = originalFinalize;
    });

    /** Holds the database work back, to see what a student is told before it finishes. */
    const holdFinalize = () => {
      let release;
      let fail;
      const gate = new Promise((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      gate.catch(() => {});
      attempts.finalizeAttempt = async (...args) => {
        await gate;
        return originalFinalize(...args);
      };
      return { release, fail };
    };

    test("the student is told before the database has finished, and nothing more is accepted", async () => {
      const { student, attemptId, token } = await inExam();
      const hold = holdFinalize();
      const seen = await earn(attemptId, token, 3);
      assert.deepStrictEqual(seen.filter((item) => item.warningIssued).map((item) => item.currentWarnings), [1, 2, 3]);
      assert.deepStrictEqual(seen.map((item) => item.terminated), [false, false, true]);
      assert.ok(/Your exam has been ended/.test(seen[2].message));
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS", "The hold did not hold.");

      // Nothing is recorded after the exam has been ended, which is what the screenshot showed.
      const lateEvent = await monitorCall("POST", "events", token, { eventType: "VOICE_ACTIVITY_DETECTED", metadata: { durationMs: 900 } });
      assert.strictEqual(lateEvent.status, 409);
      assert.strictEqual(lateEvent.json.code, "ATTEMPT_ENDED");
      const lateFrame = await upload(token, "ONE");
      assert.strictEqual(lateFrame.status, 409);
      assert.strictEqual(lateFrame.json.code, "ATTEMPT_ENDED");

      // The page reads the result until it is there.
      assert.strictEqual((await call("GET", `/proctoring/attempts/${attemptId}/result`, student)).json.code, "ATTEMPT_NOT_ENDED");

      // Pressing Submit in that moment cannot turn a termination into an ordinary finish.
      const submitted = await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      assert.strictEqual(submitted.status, 409);
      assert.strictEqual(submitted.json.code, "ATTEMPT_ENDED");

      hold.release();
      await settle();
      for (let tries = 0; tries < 50 && (await row(attemptId)).status === "IN_PROGRESS"; tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
      const closed = await row(attemptId);
      assert.strictEqual(closed.status, "TERMINATED");
      assert.strictEqual(closed.terminationRule, "WARNING_LIMIT_REACHED");
      assert.strictEqual(closed.warningCount, 3);

      const result = await call("GET", `/proctoring/attempts/${attemptId}/result`, student);
      assert.strictEqual(result.status, 200, result.text);
      assert.strictEqual(result.data.outcome, "ENDED_BY_PROCTORING");
      assert.strictEqual(result.data.warningCount, 3);
      const recorded = await events(attemptId);
      const last = recorded[recorded.length - 1];
      assert.ok(["AUTO_TERMINATION_ENFORCED", "ATTEMPT_FLAGGED"].includes(last.eventType), `${last.eventType} came after the end.`);
      assert.strictEqual((await events(attemptId, "VOICE_ACTIVITY_DETECTED")).length, 0);
      assert.strictEqual((await events(attemptId, "AUTO_TERMINATION_ENFORCED")).length, 1);
    });

    test("the result is right from the moment the attempt closes, before the later counter flush", async () => {
      const { student, attemptId, token } = await inExam();
      const originalNotify = registry.notifyEnded;
      let release;
      const held = new Promise((resolve) => {
        release = resolve;
      });
      registry.notifyEnded = async (...args) => {
        await held;
        return originalNotify(...args);
      };
      try {
        await earn(attemptId, token, 3);
        let closed = await row(attemptId);
        for (let tries = 0; tries < 50 && closed.status === "IN_PROGRESS"; tries += 1) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          closed = await row(attemptId);
        }
        assert.strictEqual(closed.status, "TERMINATED");
        const result = await call("GET", `/proctoring/attempts/${attemptId}/result`, student);
        assert.strictEqual(result.status, 200, result.text);
        assert.strictEqual(result.data.warningCount, 3, "The reason says 3/3, so the count must too.");
        assert.strictEqual(result.data.telemetry.framesReceived, 3);
      } finally {
        registry.notifyEnded = originalNotify;
        release();
      }
      await settle();
    });

    test("a client event reaching the limit also tells the student at once", async () => {
      const { attemptId, token } = await inExam();
      const hold = holdFinalize();
      const start = (await notices(token)).data.cursor;
      const earnWarning = (eventType) => {
        registry.peek(attemptId).lastWarningAt = null;
        registry.peek(attemptId).lastSameActionAt = {};
        return monitorCall("POST", "events", token, { eventType });
      };
      assert.strictEqual((await earnWarning("FULLSCREEN_EXIT")).status, 200);
      assert.strictEqual((await earnWarning("TAB_HIDDEN")).status, 200);
      // One request is already waiting when the limit is reached: it hears the notice. Any later one is refused.
      const { data: { cursor } } = await notices(token);
      const waiting = notices(token, cursor);
      const third = earnWarning("WINDOW_BLUR");
      const { data: heard } = await waiting;
      assert.ok(heard.notices.some((item) => item.terminated), "The channel never said it ended.");
      assert.strictEqual((await notices(token, start)).json.code, "ATTEMPT_ENDED");
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
      hold.release();
      const response = await third;
      assert.strictEqual(response.data.policyResult.terminated, true);
      assert.ok(response.data.policyResult.noticeId, "Lets the page ignore the copy it already showed.");
      await settle();
      assert.strictEqual((await row(attemptId)).status, "TERMINATED");
    });

    test("a database failure while ending is retried, and the exam stays closed to the student", async () => {
      const { student, attemptId, token } = await inExam();
      const hold = holdFinalize();
      await earn(attemptId, token, 3);
      hold.fail(new Error("database went away"));
      await queue.analysisQueue.drain();
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
      assert.ok(registry.peek(attemptId).pendingTermination);
      assert.strictEqual((await monitorCall("POST", "heartbeat", token, {})).json.code, "ATTEMPT_ENDED");

      attempts.finalizeAttempt = originalFinalize;
      await monitor.watchdogTick();
      const closed = await row(attemptId);
      assert.strictEqual(closed.status, "TERMINATED");
      assert.strictEqual((await call("GET", `/proctoring/attempts/${attemptId}/result`, student)).data.outcome, "ENDED_BY_PROCTORING");
    });
  });

  describe("evidence for what the browser reports", () => {
    test("leaving fullscreen keeps the frame just before it and the frames just after", async () => {
      const { student, attemptId, token } = await inExam();
      assert.strictEqual((await upload(token, "ONE")).status, 200);
      await queue.analysisQueue.drain();
      const exit = await monitorCall("POST", "events", token, { eventType: "FULLSCREEN_EXIT", metadata: { keyboardLock: "active", escHeldMs: 1600 } });
      assert.strictEqual(exit.data.policyResult.warningIssued, true);
      assert.ok(registry.peek(attemptId).violationUntil > new Date());
      assert.strictEqual((await upload(token, "ONE", { type: "INCIDENT_SNAPSHOT" })).status, 200);
      await settle();
      const kept = await prisma.proctoringEvidence.findMany({ where: { attemptId, category: "VIOLATION" } });
      assert.strictEqual(kept.length, 2);

      const recorded = await events(attemptId, "FULLSCREEN_EXIT");
      assert.strictEqual(recorded.length, 1);
      assert.strictEqual(recorded[0].metadata.keyboardLock, "active");
      assert.strictEqual(recorded[0].metadata.escHeldMs, 1600);
      assert.strictEqual(recorded[0].metadata.evidenceIds.length, 1, "So the instructor's timeline shows the photo beside the event.");

      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
      const result = await call("GET", `/proctoring/attempts/${attemptId}/result`, student);
      assert.ok(result.data.violations.find((item) => item.eventType === "FULLSCREEN_EXIT").evidenceId);
    });

    test("an event that earns no warning keeps nothing, so a clean exam stays clean", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "ONE");
      await queue.analysisQueue.drain();
      await monitorCall("POST", "events", token, { eventType: "FULLSCREEN_ENTER" });
      await settle();
      assert.strictEqual(await prisma.proctoringEvidence.count({ where: { attemptId, category: "VIOLATION" } }), 0);
    });
  });

  describe("starting with a screen capture running", () => {
    test("is refused, nothing starts, and starting works once it has stopped", async () => {
      const { student, attemptId } = await readyToStart();
      const refused = await call("POST", `/proctoring/attempts/${attemptId}/start`, student, { readiness: { screenCaptureSessions: 1, recordingClosedConfirmed: true } });
      assert.strictEqual(refused.status, 409);
      assert.strictEqual(refused.json.code, "SCREEN_CAPTURE_ACTIVE");
      const waiting = await row(attemptId);
      assert.strictEqual(waiting.status, "PREPARING");
      assert.strictEqual(waiting.startedAt, null);

      const started = await call("POST", `/proctoring/attempts/${attemptId}/start`, student, { readiness: { screenCaptureSessions: 0, recordingClosedConfirmed: true } });
      assert.strictEqual(started.status, 200, started.text);
      assert.strictEqual((await row(attemptId)).status, "IN_PROGRESS");
      const audit = await prisma.auditEvent.findFirst({ where: { userId: student.id, eventType: "PROCTORING_ATTEMPT_STARTED" } });
      assert.deepStrictEqual(audit.metadata.readiness, { screenCaptureSessions: 0, recordingClosedConfirmed: true });
    });

    test("a client that says nothing about it still starts, as before", async () => {
      const { student, attemptId } = await readyToStart();
      const started = await call("POST", `/proctoring/attempts/${attemptId}/start`, student);
      assert.strictEqual(started.status, 200, started.text);
    });

    test("nonsense in the report is refused", async () => {
      const { student, attemptId } = await readyToStart();
      const res = await call("POST", `/proctoring/attempts/${attemptId}/start`, student, { readiness: { screenCaptureSessions: -1 } });
      assert.strictEqual(res.status, 400);
    });
  });

  describe("how long evidence is kept", () => {
    afterEach(() => {
      delete process.env.PROCTORING_CLEAN_RETENTION_DAYS;
      delete process.env.PROCTORING_VIOLATION_RETENTION_DAYS;
    });

    const daysKept = async (attemptId, category) => {
      const kept = await prisma.proctoringEvidence.findFirst({ where: { attemptId, category } });
      return Math.round((kept.retainUntil.getTime() - kept.receivedAt.getTime()) / 86_400_000);
    };

    test("clean photos and violations both default to three days", async () => {
      const { attemptId, token } = await inExam();
      await upload(token, "ONE");
      await queue.analysisQueue.drain();
      await monitorCall("POST", "events", token, { eventType: "FULLSCREEN_EXIT" });
      await upload(token, "ONE");
      await settle();
      assert.strictEqual(await daysKept(attemptId, "VIOLATION"), 3);
    });

    test("the settings change both, and nonsense cannot delete evidence early", async () => {
      process.env.PROCTORING_CLEAN_RETENTION_DAYS = "5";
      process.env.PROCTORING_VIOLATION_RETENTION_DAYS = "30";
      const { attemptId, token } = await inExam();
      await upload(token, "ONE");
      await settle();
      assert.strictEqual(await daysKept(attemptId, "PERIODIC"), 5);
      await monitorCall("POST", "events", token, { eventType: "FULLSCREEN_EXIT" });
      await upload(token, "ONE");
      await settle();
      assert.strictEqual(await daysKept(attemptId, "VIOLATION"), 30);

      const { proctoringSettings } = require("../src/config/proctoring");
      const settings = proctoringSettings({ PROCTORING_CLEAN_RETENTION_DAYS: "0", PROCTORING_VIOLATION_RETENTION_DAYS: "-5" });
      assert.strictEqual(settings.cleanRetentionDays, 3);
      assert.strictEqual(settings.violationRetentionDays, 3);
    });

    test("evidence under review stays for the long period whatever it was kept as", async () => {
      process.env.PROCTORING_CLEAN_RETENTION_DAYS = "3";
      process.env.PROCTORING_VIOLATION_RETENTION_DAYS = "30";
      const { student, attemptId, token } = await inExam();
      await upload(token, "ONE");
      await settle();
      await evidence.holdAttemptEvidence(attemptId);
      const held = await prisma.proctoringEvidence.findFirst({ where: { attemptId, category: "PERIODIC" } });
      assert.strictEqual(held.reviewHold, true);
      assert.ok(held.retainUntil.getTime() > Date.now() + 29 * 86_400_000);
      await call("POST", `/proctoring/attempts/${attemptId}/submit`, student);
    });
  });
});
