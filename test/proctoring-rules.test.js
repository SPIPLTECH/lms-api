/**
 * The monitoring rules as pure logic, ported from ProctorGuard's rule tests with the owner's
 * changes: only a sustained phone or a sustained second person ends an exam, and everything
 * else that used to terminate now flags.
 */
const { describe, test } = require("node:test");
const assert = require("node:assert");

const { proctoringSettings } = require("../src/config/proctoring");
const {
  AI_RULES,
  activeRuns,
  calculateRisk,
  detectViolations,
  getTrustedEventSeverity,
  isViolationEvent,
  isWarningEligible,
  priorityOf,
  ruleMet,
  summarise,
} = require("../src/modules/proctoring/rules");

const settings = proctoringSettings({});
const at = (seconds) => new Date(Date.UTC(2026, 9, 31, 10, 0, seconds));
const event = (id, eventType, metadata = {}, when = at(0)) => ({ id, eventType, serverTimestamp: when, metadata });
const rule = (triggers, name) => triggers.find((t) => t.rule === name);
const onlyAction = (triggers, name) => rule(triggers, name)?.action;

describe("what ends an exam and what flags it", () => {
  const phone = (signalConfidence, consecutiveSnapshots, sustainedSeconds) =>
    event("e1", "PROHIBITED_OBJECT_DETECTED", { signalConfidence, consecutiveSnapshots, sustainedSeconds, labels: ["cell phone"], evidenceIds: ["f1", "f2"] });

  test("a sustained phone ends the exam", () => {
    const triggers = detectViolations([phone(0.65, 2, 10)], settings);
    assert.strictEqual(onlyAction(triggers, "CONFIRMED_PROHIBITED_OBJECT"), "TERMINATE");
    assert.deepStrictEqual(rule(triggers, "CONFIRMED_PROHIBITED_OBJECT").evidenceFrameIds, ["f1", "f2"]);
  });

  test("a phone that has not lasted long enough does not end the exam", () => {
    assert.strictEqual(rule(detectViolations([phone(0.65, 2, 9)], settings), "CONFIRMED_PROHIBITED_OBJECT"), undefined);
    assert.strictEqual(rule(detectViolations([phone(0.65, 1, 30)], settings), "CONFIRMED_PROHIBITED_OBJECT"), undefined);
  });

  test("a low-confidence phone does nothing, however long it lasts", () => {
    assert.deepStrictEqual(detectViolations([phone(0.45, 5, 60)], settings), []);
  });

  test("a single high-confidence phone frame flags and does not end, even with corroboration", () => {
    const alone = detectViolations([phone(0.9, 1, 0)], settings);
    assert.strictEqual(onlyAction(alone, "SINGLE_HIGH_CONFIDENCE_OBJECT"), "FLAG");
    const corroborated = detectViolations([phone(0.9, 1, 0), event("e2", "HEAD_POSE_AWAY"), event("e3", "TAB_HIDDEN")], settings);
    assert.strictEqual(onlyAction(corroborated, "SINGLE_HIGH_CONFIDENCE_OBJECT"), "FLAG");
    assert.ok(!corroborated.some((t) => t.action === "TERMINATE"));
  });

  test("a sustained second person ends the exam; a brief or doubtful one does not", () => {
    const person = (signalConfidence, consecutiveSnapshots, sustainedSeconds) =>
      event("e1", "MULTIPLE_FACES_DETECTED", { signalConfidence, consecutiveSnapshots, sustainedSeconds, maxFaces: 2 });
    assert.strictEqual(onlyAction(detectViolations([person(0.9, 2, 10)], settings), "PERSISTENT_MULTIPLE_FACES"), "TERMINATE");
    assert.deepStrictEqual(detectViolations([person(0.9, 1, 0)], settings), []);
    assert.deepStrictEqual(detectViolations([person(0.9, 2, 5)], settings), []);
    assert.deepStrictEqual(detectViolations([person(0.5, 5, 60)], settings), []);
  });

  test("identity mismatch flags and never ends", () => {
    const triggers = detectViolations([event("e1", "IDENTITY_MISMATCH_DETECTED", { consecutiveSnapshots: 10, sustainedSeconds: 300, signalConfidence: 1 })], settings);
    assert.strictEqual(onlyAction(triggers, "PERSISTENT_IDENTITY_MISMATCH"), "FLAG");
    assert.deepStrictEqual(detectViolations([event("e1", "IDENTITY_MISMATCH_DETECTED", { consecutiveSnapshots: 2, sustainedSeconds: 300 })], settings), []);
  });

  test("absence flags and never ends, and needs length or corroboration", () => {
    const long = event("e1", "FACE_NOT_DETECTED", { consecutiveSnapshots: 20, sustainedSeconds: 600 });
    assert.strictEqual(onlyAction(detectViolations([long], settings), "PERSISTENT_ABSENCE"), "FLAG");
    const short = event("e1", "FACE_NOT_DETECTED", { consecutiveSnapshots: 3, sustainedSeconds: 10 });
    assert.deepStrictEqual(detectViolations([short], settings), []);
    assert.strictEqual(onlyAction(detectViolations([short, event("e2", "WINDOW_BLUR")], settings), "PERSISTENT_ABSENCE"), "FLAG");
  });

  test("a critical correlated alert flags and never ends", () => {
    const alert = event("a1", "AI_CORRELATED_ALERT", { priority: "CRITICAL", score: 8, categories: [{ key: "object", ai: true, signalConfidence: 0.9 }] });
    assert.strictEqual(onlyAction(detectViolations([alert], settings), "CORRELATED_CRITICAL_VIOLATION"), "FLAG");
    const high = event("a1", "AI_CORRELATED_ALERT", { priority: "HIGH", score: 5, categories: [{ key: "object", ai: true, signalConfidence: 0.9 }] });
    assert.deepStrictEqual(detectViolations([high], settings), []);
  });

  test("the allow-list decides what may end an exam", () => {
    const narrowed = proctoringSettings({ AI_TERMINATING_RULES: "PERSISTENT_MULTIPLE_FACES" });
    const triggers = detectViolations([phone(0.65, 2, 10)], narrowed);
    assert.strictEqual(onlyAction(triggers, "CONFIRMED_PROHIBITED_OBJECT"), "FLAG");
  });

  test("automatic ending can be switched off, and then the same signal flags", () => {
    const off = proctoringSettings({ AI_AUTO_TERMINATE_ENABLED: "false" });
    assert.strictEqual(onlyAction(detectViolations([phone(0.65, 2, 10)], off), "CONFIRMED_PROHIBITED_OBJECT"), "FLAG");
  });

  test("what a student is told never carries a confidence score", () => {
    for (const triggers of [detectViolations([phone(0.91, 2, 10)], settings), detectViolations([phone(0.91, 1, 0)], settings)]) {
      for (const trigger of triggers) assert.ok(!/\d+%|0\.\d/.test(trigger.reason), trigger.reason);
    }
  });
});

describe("runs of frames", () => {
  const frame = (id, seconds, result) => ({ id, receivedAt: at(seconds), result });
  const ok = (extra) => ({ status: "OK", classification: "ONE_FACE", facesDetected: 1, faces: [{ score: 0.9 }], objects: { status: "OK", items: [] }, ...extra });
  const phone = ok({ objects: { status: "OK", items: [{ label: "cell phone", score: 0.8 }] } });

  test("measures how many frames and how long, newest first", () => {
    const runs = activeRuns([frame("f3", 20, phone), frame("f2", 10, phone), frame("f1", 0, phone)], settings);
    const run = runs.find((r) => r.eventType === "PROHIBITED_OBJECT_DETECTED");
    assert.strictEqual(run.consecutiveSnapshots, 3);
    assert.strictEqual(run.sustainedSeconds, 20);
    assert.strictEqual(run.runStartFrameId, "f1");
    assert.deepStrictEqual(run.evidenceFrameIds, ["f3", "f2", "f1"]);
  });

  test("a clean frame ends the run", () => {
    const runs = activeRuns([frame("f3", 20, phone), frame("f2", 10, ok()), frame("f1", 0, phone)], settings);
    assert.strictEqual(runs.find((r) => r.eventType === "PROHIBITED_OBJECT_DETECTED").consecutiveSnapshots, 1);
  });

  test("an unanalysed frame breaks the run, so an outage can never build toward an ending", () => {
    const runs = activeRuns([frame("f3", 20, phone), frame("f2", 10, { status: "UNAVAILABLE" }), frame("f1", 0, phone)], settings);
    assert.strictEqual(runs.find((r) => r.eventType === "PROHIBITED_OBJECT_DETECTED").consecutiveSnapshots, 1);
    assert.deepStrictEqual(activeRuns([frame("f1", 0, { status: "UNAVAILABLE" })], settings), []);
  });

  test("no face and two faces are told apart", () => {
    const none = ok({ classification: "NO_FACE", facesDetected: 0, faces: [] });
    const two = ok({ classification: "MULTIPLE_FACES", facesDetected: 2, faces: [{ score: 0.9 }, { score: 0.7 }] });
    assert.deepStrictEqual(activeRuns([frame("f1", 0, none)], settings).map((r) => r.eventType), ["FACE_NOT_DETECTED"]);
    const runs = activeRuns([frame("f1", 0, two)], settings);
    assert.strictEqual(runs[0].eventType, "MULTIPLE_FACES_DETECTED");
    assert.strictEqual(runs[0].details.signalConfidence, 0.7, "the weakest second face");
  });

  test("sustained-duration and confidence gates prevent 2-second recheck and borderline false positives", () => {
    const findRule = (type) => AI_RULES.find((r) => r.eventType === type);
    const away = ok({ headPose: { orientation: "AWAY", direction: "LEFT", yawDeg: 45, yawThresholdDeg: 35 } });
    const none = ok({ classification: "NO_FACE", facesDetected: 0, faces: [] });
    const borderlinePhone = ok({ objects: { status: "OK", items: [{ label: "cell phone", score: 0.45 }] } });

    const briefAway = activeRuns([frame("f2", 2, away), frame("f1", 0, away)])[0];
    assert.strictEqual(ruleMet(findRule("HEAD_POSE_AWAY"), briefAway, settings), false, "2s recheck alone does not warn");
    const sustainedAway = activeRuns([frame("f2", 5, away), frame("f1", 0, away)])[0];
    assert.strictEqual(ruleMet(findRule("HEAD_POSE_AWAY"), sustainedAway, settings), true, "5s sustained head turn warns");

    const briefNone = activeRuns([frame("f2", 1, none), frame("f1", 0, none)])[0];
    assert.strictEqual(ruleMet(findRule("FACE_NOT_DETECTED"), briefNone, settings), false, "two photos 1 s apart: a blink or a blur");
    const sustainedNone = activeRuns([frame("f2", 2, none), frame("f1", 0, none)])[0];
    assert.strictEqual(ruleMet(findRule("FACE_NOT_DETECTED"), sustainedNone, settings), true, "2 s without a face warns");

    const oneBorderline = activeRuns([frame("f1", 0, borderlinePhone)])[0];
    assert.strictEqual(ruleMet(findRule("PROHIBITED_OBJECT_DETECTED"), oneBorderline, settings), false, "single 0.45 object waits for recheck");
    const twoBorderline = activeRuns([frame("f2", 2, borderlinePhone), frame("f1", 0, borderlinePhone)])[0];
    assert.strictEqual(ruleMet(findRule("PROHIBITED_OBJECT_DETECTED"), twoBorderline, settings), true);
    const oneConfident = activeRuns([frame("f1", 0, phone)])[0];
    assert.strictEqual(ruleMet(findRule("PROHIBITED_OBJECT_DETECTED"), oneConfident, settings), true);
  });

  describe("a count is not restarted by a photo that says nothing against it", () => {
    const findRule = (type) => AI_RULES.find((r) => r.eventType === type);
    const none = ok({ classification: "NO_FACE", facesDetected: 0, faces: [] });
    const you = ok({ identity: { status: "MATCH", similarity: 0.85 } });
    const other = (similarity, score = 0.63) => ok({ faces: [{ score }], identity: { status: "MISMATCH", similarity } });
    const run = (frames, type) => activeRuns(frames).find((r) => r.eventType === type);
    const met = (frames, type) => Boolean(run(frames, type) && ruleMet(findRule(type), run(frames, type), settings));

    test("a moment with no face does not restart a different-person count; the student's own face does", () => {
      const across = run([frame("f3", 3, other(0.3)), frame("f2", 2, none), frame("f1", 0, other(0.3))], "IDENTITY_MISMATCH_DETECTED");
      assert.strictEqual(across.consecutiveSnapshots, 2);
      assert.deepStrictEqual(across.evidenceFrameIds, ["f3", "f1"], "only photos that show the other person are evidence");
      assert.strictEqual(run([frame("f3", 3, other(0.3)), frame("f2", 2, you), frame("f1", 0, other(0.3))], "IDENTITY_MISMATCH_DETECTED").consecutiveSnapshots, 1);
    });

    test("one glimpse of a face does not restart a no-face count; two in a row do", () => {
      assert.strictEqual(run([frame("f3", 3, none), frame("f2", 2, you), frame("f1", 0, none)], "FACE_NOT_DETECTED").consecutiveSnapshots, 2);
      assert.strictEqual(run([frame("f4", 4, none), frame("f3", 3, you), frame("f2", 2, you), frame("f1", 0, none)], "FACE_NOT_DETECTED").consecutiveSnapshots, 1);
      assert.strictEqual(run([frame("f5", 5, none), frame("f4", 4, you), frame("f3", 3, none), frame("f2", 2, you), frame("f1", 0, none)], "FACE_NOT_DETECTED").consecutiveSnapshots, 2, "only one glimpse is forgiven per run");
    });

    test("a problem shows as current only while the newest photo shows it", () => {
      assert.strictEqual(run([frame("f2", 2, you), frame("f1", 0, none)], "FACE_NOT_DETECTED"), undefined);
      assert.strictEqual(run([frame("f2", 2, none), frame("f1", 0, other(0.3))], "IDENTITY_MISMATCH_DETECTED"), undefined);
    });

    test("one clearly different person warns at once; a doubtful one or a blurred face waits for a second photo", () => {
      assert.strictEqual(met([frame("f1", 0, other(0.07))], "IDENTITY_MISMATCH_DETECTED"), true, "similarity 0.07, face 63%");
      assert.strictEqual(met([frame("f1", 0, other(0.3))], "IDENTITY_MISMATCH_DETECTED"), false, "0.30 is close to the 0.36 match line");
      assert.strictEqual(met([frame("f1", 0, other(0.07, 0.5))], "IDENTITY_MISMATCH_DETECTED"), false, "a weak face can be misread");
      assert.strictEqual(met([frame("f2", 2, other(0.3)), frame("f1", 0, other(0.3))], "IDENTITY_MISMATCH_DETECTED"), true);
    });

    test("the exam of 2026-11-04 12:07 IST, replayed: each problem is confirmed at its first possible photo", () => {
      // The 16 analysed photos of that exam: warnings were confirmed at 13.9, 24.2 and 33.2 s.
      const photos = [[8.084, you], [10.897, you], [13.883, ok({ objects: { status: "OK", items: [{ label: "cell phone", score: 0.71 }] } })], [16.069, you], [16.874, you],
        [19.872, other(0.073)], [22.059, none], [22.892, other(0.123, 0.61)], [24.204, other(0.144, 0.55)], [25.873, other(-0.106, 0.61)], [26.381, none],
        [28.436, you], [28.872, none], [31.035, none], [31.868, none], [33.192, none]];
      const firstMet = {};
      const newest = [];
      for (const [seconds, result] of photos) {
        newest.unshift({ id: String(seconds), receivedAt: new Date(at(0).getTime() + seconds * 1000), result });
        for (const type of ["PROHIBITED_OBJECT_DETECTED", "IDENTITY_MISMATCH_DETECTED", "FACE_NOT_DETECTED"]) if (!(type in firstMet) && met(newest, type)) firstMet[type] = seconds;
      }
      assert.deepStrictEqual(firstMet, { PROHIBITED_OBJECT_DETECTED: 13.883, IDENTITY_MISMATCH_DETECTED: 19.872, FACE_NOT_DETECTED: 28.872 });
    });
  });

  test("a phone held close to the camera warns from one frame, though the model rarely sees it twice", () => {
    // A real exam on 2026-11-03: a phone in view for 8 s scored 0.543, then nothing on the re-check.
    const findRule = (type) => AI_RULES.find((r) => r.eventType === type);
    const heldUp = ok({ objects: { status: "OK", items: [{ label: "cell phone", score: 0.543 }] } });
    assert.strictEqual(ruleMet(findRule("PROHIBITED_OBJECT_DETECTED"), activeRuns([frame("f1", 0, heldUp)])[0], settings), true);
  });
});

describe("correlation", () => {
  test("repeats of one signal never raise the score", () => {
    const summary = summarise([event("a", "TAB_HIDDEN"), event("b", "WINDOW_BLUR"), event("c", "TAB_HIDDEN")]);
    assert.strictEqual(summary.categories.length, 1);
    assert.strictEqual(summary.score, 1);
  });

  test("independent signals add up and set the priority", () => {
    const summary = summarise([event("a", "PROHIBITED_OBJECT_DETECTED", { signalConfidence: 0.9 }), event("b", "MULTIPLE_FACES_DETECTED", { signalConfidence: 0.8 }), event("c", "VOICE_ACTIVITY_DETECTED")]);
    assert.strictEqual(summary.score, 8);
    assert.strictEqual(summary.priority, "CRITICAL");
  });

  test("priority bands", () => {
    assert.deepStrictEqual([priorityOf(2), priorityOf(3), priorityOf(5), priorityOf(7)], ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });
});

describe("warnings", () => {
  test("severity comes from the server's table", () => {
    assert.strictEqual(getTrustedEventSeverity("FULLSCREEN_EXIT"), "HIGH");
    assert.strictEqual(getTrustedEventSeverity("TAB_HIDDEN"), "MEDIUM");
    assert.strictEqual(getTrustedEventSeverity("COPY_ATTEMPT"), "LOW");
    assert.strictEqual(getTrustedEventSeverity("ANYTHING_ELSE"), "INFO");
  });

  test("connection gaps and AI signals never warn; focus and fullscreen do", () => {
    for (const type of ["DISCONNECT", "FACE_NOT_DETECTED", "PROHIBITED_OBJECT_DETECTED", "VOICE_ACTIVITY_DETECTED", "COPY_ATTEMPT"]) assert.strictEqual(isWarningEligible(type), false, type);
    for (const type of ["TAB_HIDDEN", "WINDOW_BLUR", "FULLSCREEN_EXIT", "CAMERA_INTERRUPTED"]) assert.strictEqual(isWarningEligible(type), true, type);
  });

  test("the risk score is explainable and carries no weight for AI or connection events", () => {
    const risk = calculateRisk([{ eventType: "FULLSCREEN_EXIT" }, { eventType: "TAB_HIDDEN" }, { eventType: "PROHIBITED_OBJECT_DETECTED" }, { eventType: "DISCONNECT" }], 0);
    assert.strictEqual(risk.score, 40);
    assert.strictEqual(risk.level, "MEDIUM");
    assert.ok(risk.summary.includes("not proof"));
    assert.strictEqual(isViolationEvent("FULLSCREEN_EXIT"), true);
    assert.strictEqual(isViolationEvent("PROHIBITED_OBJECT_DETECTED"), true);
    assert.strictEqual(isViolationEvent("TAB_VISIBLE"), false);
    assert.strictEqual(isViolationEvent("AUTO_TERMINATION_ENFORCED"), false);
  });
});
