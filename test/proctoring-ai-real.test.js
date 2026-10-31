/**
 * The real Python AI and real models, started and supervised by lms-api's own process manager,
 * against the public-domain fixture photos. Skipped unless AI_PYTHON is set and the models are in
 * ai/models. These are photos, not a webcam, so this says nothing about accuracy on real students.
 */
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const net = require("net");
const path = require("path");

const AI_ROOT = path.resolve(__dirname, "../ai");
const fixture = (name) => path.join(AI_ROOT, "tests", "fixtures", name);
const MODELS = ["blaze_face_short_range.tflite", "efficientdet_lite0.tflite", "face_recognition_sface_2021dec.onnx"];
const READY = Boolean(process.env.TEST_DATABASE_URL && process.env.AI_PYTHON) && MODELS.every((file) => fs.existsSync(path.join(AI_ROOT, "models", file)));
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

const freePort = () =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

describe("the real AI", { skip: READY ? false : "needs AI_PYTHON and the models in ai/models" }, () => {
  const { createHarness } = require("./helpers/proctoringHarness");
  const h = createHarness("real");
  const { prisma, call } = h;
  let manager;
  let course;
  let adapter;
  let queue;
  let monitor;
  let evidence;
  let health;

  const analyse = (name, identity = false) => adapter.analyzeImage(fixture(name), "image/jpeg", { identity });

  const settle = async () => {
    await queue.analysisQueue.drain();
    await monitor.flushBuffers();
    await evidence.drain();
  };

  const upload = async (token, name, type = "PERIODIC_SNAPSHOT") => {
    const form = new FormData();
    form.append("type", type);
    form.append("snapshot", new Blob([fs.readFileSync(fixture(name))], { type: "image/jpeg" }), "frame.jpg");
    const res = await fetch(`${h.baseUrl()}/proctoring/monitor/snapshots`, { method: "POST", headers: { "X-Proctoring-Token": token }, body: form });
    const json = await res.json();
    return { status: res.status, data: json.data ?? json };
  };

  const inExam = async (identityPhoto = "face_victor_glover.jpg") => {
    const quiz = await h.makeQuiz(course, { proctoringEnabled: true, attempts: 3 });
    const student = await h.makeUser("STUDENT", `R${Math.random().toString(36).slice(2, 7)}`);
    await h.enroll(course, student);
    const status = await call("GET", `/proctoring/quizzes/${quiz.id}/status`, student);
    assert.strictEqual(status.data.canStart, true, status.text);
    const created = await call("POST", `/proctoring/quizzes/${quiz.id}/attempts`, student, { consent: { accepted: true, wordingVersion: status.data.consent.wordingVersion } }, { "User-Agent": CHROME });
    assert.strictEqual(created.status, 201, created.text);
    const identity = await upload(created.data.monitoringToken, identityPhoto, "PRE_EXAM_IDENTITY");
    assert.strictEqual(identity.data.identityCheck, "FACE_CHECK_PASSED", JSON.stringify(identity));
    const started = await call("POST", `/proctoring/attempts/${created.data.attemptId}/start`, student);
    assert.strictEqual(started.status, 200, started.text);
    return { attemptId: created.data.attemptId, token: started.data.monitoringToken, student };
  };

  before(async () => {
    process.env.PROCTORING_ENABLED = "true";
    process.env.AI_TERMINATE_PERSIST_SECONDS = "0";
    process.env.AI_SERVICE_URL = `http://127.0.0.1:${await freePort()}`;
    process.env.AI_SERVICE_TIMEOUT_MS = "8000";
    process.env.PYTHONDONTWRITEBYTECODE = "1";
    process.env.AI_OBJECT_SCORE_THRESHOLD = "0.3";
    await h.start();
    adapter = require("../src/modules/proctoring/ai/faceDetection.adapter");
    queue = require("../src/modules/proctoring/aiQueue");
    monitor = require("../src/modules/proctoring/monitor.service");
    evidence = require("../src/modules/proctoring/evidence.service");
    health = require("../src/modules/proctoring/ai/health");
    const { AiProcessManager, resolveAiLaunch } = require("../src/modules/proctoring/ai/processManager");
    const plan = resolveAiLaunch(
      { url: process.env.AI_SERVICE_URL, token: process.env.AI_SERVICE_TOKEN, managed: true, python: process.env.AI_PYTHON },
      path.resolve(__dirname, ".."),
      process.platform,
      process.env,
      process.pid
    );
    manager = new AiProcessManager(plan, {
      spawn: require("child_process").spawn,
      health: async () => (await health.getAiServiceHealth()).reachable,
      warn: () => {},
      info: () => {},
    });
    manager.start();
    assert.strictEqual(await manager.waitUntilHealthy(60_000), true, "the AI process came up");
    const owner = await h.makeUser("INSTRUCTOR", "Owner");
    course = await h.makeCourse(owner.id);
  });

  after(async () => {
    manager?.stop();
    await settle();
    await h.stop();
  });

  test("it reports every model loaded", async () => {
    const state = await health.getAiServiceHealth();
    assert.deepStrictEqual([state.reachable, state.faceModelLoaded, state.objectModelLoaded, state.identityModelLoaded], [true, true, true, true]);
  });

  test("one face in a portrait", async () => {
    for (const name of ["face_victor_glover.jpg", "face_raja_chari.jpg"]) {
      const result = await analyse(name);
      assert.strictEqual(result.status, "OK", JSON.stringify(result));
      assert.strictEqual(result.classification, "ONE_FACE", name);
    }
  });

  test("no face in a close-up of a phone, and the phone is found", async () => {
    const result = await analyse("phone_hand_closeup.jpg");
    assert.strictEqual(result.classification, "NO_FACE");
    assert.ok(result.objects.items.length >= 1, "phone found");
  });

  test("identity: the same person across photo sessions matches, different people do not", async () => {
    const { proctoringSettings } = require("../src/config/proctoring");
    const threshold = proctoringSettings().identityMatchThreshold;
    const vector = async (name) => (await analyse(name, true)).embedding;
    const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0) / Math.sqrt(a.reduce((sum, value) => sum + value * value, 0) * b.reduce((sum, value) => sum + value * value, 0));
    const glover = await vector("face_victor_glover.jpg");
    assert.ok(cosine(glover, await vector("face_victor_glover_2018.jpg")) >= threshold, "same person");
    assert.ok(cosine(glover, await vector("face_raja_chari.jpg")) < threshold, "different person");
  });

  test("a whole exam: real photos pass the check, a clean frame is clean, a different person flags", async () => {
    const { attemptId, token } = await inExam();
    assert.strictEqual((await upload(token, "face_victor_glover_2018.jpg")).status, 200);
    await settle();
    assert.strictEqual((await prisma.proctoringEvent.count({ where: { attemptId, eventType: "IDENTITY_MISMATCH_DETECTED" } })), 0);

    for (let i = 0; i < 3; i += 1) await upload(token, "face_raja_chari.jpg");
    await settle();
    const attempt = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
    assert.strictEqual(attempt.status, "IN_PROGRESS");
    assert.ok(attempt.flags.some((flag) => flag.reason === "PERSISTENT_IDENTITY_MISMATCH"), JSON.stringify(attempt.flags));
  });

  test("a whole exam: a phone that stays in view ends it", async () => {
    const { attemptId, token } = await inExam();
    for (let i = 0; i < 3; i += 1) await upload(token, "phone_woman_holding.jpg");
    await settle();
    const attempt = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId }, include: { quizAttempt: true } });
    assert.strictEqual(attempt.status, "TERMINATED", JSON.stringify(attempt.flags));
    assert.strictEqual(attempt.terminationRule, "CONFIRMED_PROHIBITED_OBJECT");
    assert.strictEqual(attempt.quizAttempt.passed, false);
  });

  test("killing the AI during an exam: the exam goes on and is flagged, and the manager brings it back", async () => {
    const { attemptId, token } = await inExam();
    manager.child.kill();
    for (let i = 0; i < 4; i += 1) assert.strictEqual((await upload(token, "face_victor_glover.jpg")).status, 200);
    await settle();
    const attempt = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
    assert.strictEqual(attempt.status, "IN_PROGRESS");
    assert.ok(attempt.flags.some((flag) => flag.reason === "AI_UNAVAILABLE"), JSON.stringify(attempt.flags));

    assert.strictEqual(await manager.waitUntilHealthy(60_000), true, "restarted by the manager");
    health.resetAiHealthCache();
    await upload(token, "face_victor_glover.jpg");
    await settle();
    await monitor.flushCounters();
    const after = await prisma.proctoredAttempt.findUnique({ where: { id: attemptId } });
    assert.ok(after.framesAnalysed >= 1, "analysing again");
    assert.strictEqual(after.status, "IN_PROGRESS");
  });
});
