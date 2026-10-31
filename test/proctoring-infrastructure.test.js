/**
 * The parts that need no database: the analysis queue, back-pressure, the evidence store
 * with its encryption (real R2 is NOT tested; a fake client stands in), and the process
 * manager that supervises the Python AI.
 */
const { describe, test } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AnalysisQueue, intervalFor } = require("../src/modules/proctoring/aiQueue");
const { createLocalStore, createR2Store, decrypt, encrypt, parseKeys } = require("../src/modules/proctoring/evidenceStore");
const { AiProcessManager, resolveAiLaunch, startManagedAi } = require("../src/modules/proctoring/ai/processManager");

const later = () => new Promise((resolve) => setImmediate(resolve));

describe("analysis queue", () => {
  const deferred = () => {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
  };

  test("runs no more than the concurrency limit at once", async () => {
    const queue = new AnalysisQueue(() => 2, () => 100);
    let running = 0;
    let peak = 0;
    const gates = [];
    for (let i = 0; i < 6; i += 1) {
      const gate = deferred();
      gates.push(gate);
      queue.enqueue({
        attemptId: `a${i}`,
        run: async () => {
          running += 1;
          peak = Math.max(peak, running);
          await gate.promise;
          running -= 1;
        },
      });
    }
    await later();
    assert.strictEqual(running, 2);
    gates.forEach((gate) => gate.resolve());
    await queue.drain();
    assert.strictEqual(peak, 2);
    assert.strictEqual(queue.metrics().completed, 6);
  });

  test("a full queue refuses new work instead of growing", () => {
    const queue = new AnalysisQueue(() => 1, () => 2);
    const never = new Promise(() => {});
    assert.strictEqual(queue.enqueue({ attemptId: "a", run: () => never }), true);
    assert.strictEqual(queue.enqueue({ attemptId: "b", run: () => never }), true);
    assert.strictEqual(queue.enqueue({ attemptId: "c", run: () => never }), true);
    assert.strictEqual(queue.enqueue({ attemptId: "d", run: () => never }), false);
    assert.strictEqual(queue.metrics().rejectedQueueFull, 1);
  });

  test("one attempt's frames run in order, never two at once", async () => {
    const queue = new AnalysisQueue(() => 4, () => 100);
    const order = [];
    let running = 0;
    for (let i = 0; i < 4; i += 1) {
      queue.enqueue({
        attemptId: "same",
        run: async () => {
          running += 1;
          assert.strictEqual(running, 1);
          await later();
          order.push(i);
          running -= 1;
        },
      });
    }
    await queue.drain();
    assert.deepStrictEqual(order, [0, 1, 2, 3]);
  });

  test("identity photos go ahead of waiting frames, and have room when frames are full", async () => {
    const queue = new AnalysisQueue(() => 1, () => 2);
    const order = [];
    const gate = deferred();
    queue.enqueue({ attemptId: "busy", run: () => gate.promise });
    queue.enqueue({ attemptId: "f1", run: async () => order.push("frame1") });
    queue.enqueue({ attemptId: "f2", run: async () => order.push("frame2") });
    assert.strictEqual(queue.enqueue({ attemptId: "f3", run: async () => order.push("frame3") }), false);
    assert.strictEqual(queue.enqueue({ attemptId: "id", priority: true, run: async () => order.push("identity") }), true);
    gate.resolve();
    await queue.drain();
    assert.deepStrictEqual(order, ["identity", "frame1", "frame2"]);
  });

  test("a failing job never stops the queue", async () => {
    const queue = new AnalysisQueue(() => 1, () => 10);
    let ran = false;
    queue.enqueue({ attemptId: "a", run: async () => { throw new Error("boom"); } });
    queue.enqueue({ attemptId: "b", run: async () => { ran = true; } });
    await queue.drain();
    assert.strictEqual(ran, true);
    assert.strictEqual(queue.metrics().crashed, 1);
  });

  test("back-pressure lengthens the capture interval as the backlog grows, up to 15 s", () => {
    const at = (backlog) => intervalFor(5, { backlog, queueLimit: 100 });
    assert.deepStrictEqual([at(0), at(24), at(25), at(49), at(50), at(100)], [5, 5, 10, 10, 15, 15]);
    assert.strictEqual(intervalFor(20, { backlog: 100, queueLimit: 100 }), 20, "never shorter than the setting");
  });
});

describe("evidence encryption", () => {
  const key = (id) => `${id}:${crypto.randomBytes(32).toString("base64")}`;

  test("round trip, and the stored bytes do not contain the image", () => {
    const keys = parseKeys(key("k1"));
    const image = Buffer.from("IMAGE-BYTES-THAT-MUST-NOT-APPEAR");
    const sealed = encrypt(image, "object/1", keys);
    assert.ok(!sealed.includes(image));
    assert.deepStrictEqual(decrypt(sealed, "object/1", keys), image);
  });

  test("the same image never encrypts the same way twice", () => {
    const keys = parseKeys(key("k1"));
    assert.ok(!encrypt(Buffer.from("x"), "o", keys).equals(encrypt(Buffer.from("x"), "o", keys)));
  });

  test("tampering, or moving an object to another key, is refused", () => {
    const keys = parseKeys(key("k1"));
    const sealed = encrypt(Buffer.from("x"), "object/1", keys);
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] ^= 1;
    assert.throws(() => decrypt(tampered, "object/1", keys));
    assert.throws(() => decrypt(sealed, "object/2", keys));
  });

  test("rotation: the first key encrypts, older keys still decrypt", () => {
    const oldKey = key("old");
    const oldSealed = encrypt(Buffer.from("x"), "o", parseKeys(oldKey));
    const rotated = parseKeys(`${key("new")},${oldKey}`);
    assert.deepStrictEqual(decrypt(oldSealed, "o", rotated), Buffer.from("x"));
    assert.strictEqual(rotated.active.id, "new");
    assert.strictEqual(encrypt(Buffer.from("x"), "o", rotated).includes(Buffer.from("new")), true);
  });

  test("bad key settings are refused", () => {
    assert.throws(() => parseKeys(""));
    assert.throws(() => parseKeys("k1:short"));
    assert.throws(() => parseKeys("no-colon"));
  });
});

describe("evidence stores", () => {
  const keys = parseKeys(`k1:${crypto.randomBytes(32).toString("base64")}`);
  const image = Buffer.from("IMAGE");

  test("local driver: encrypted on disk, read back, deleted, and no path escapes", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-"));
    const store = createLocalStore({ dir, keys });
    await store.put("attempt/1.bin", image);
    const onDisk = fs.readFileSync(path.join(dir, "attempt", "1.bin"));
    assert.ok(!onDisk.includes(image));
    assert.deepStrictEqual(await store.get("attempt/1.bin"), image);
    await store.delete("attempt/1.bin");
    assert.strictEqual(fs.existsSync(path.join(dir, "attempt", "1.bin")), false);
    await store.delete("attempt/1.bin");
    await assert.rejects(store.put("../escape.bin", image));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("R2 driver through a FAKE client: the private bucket, encrypted bytes, no public access set", async () => {
    const saved = new Map();
    const commands = [];
    const client = {
      send: async (command) => {
        commands.push(command);
        const { Bucket, Key, Body } = command.input;
        assert.strictEqual(Bucket, "evidence-bucket");
        const name = command.constructor.name;
        if (name === "PutObjectCommand") saved.set(Key, Body);
        if (name === "DeleteObjectCommand") saved.delete(Key);
        if (name === "GetObjectCommand") return { Body: { transformToByteArray: async () => saved.get(Key) } };
        return {};
      },
    };
    const store = createR2Store({ client, bucket: "evidence-bucket", keys });
    await store.put("a/1.bin", image);
    assert.ok(!saved.get("a/1.bin").includes(image));
    assert.strictEqual(commands[0].input.ACL, undefined);
    assert.deepStrictEqual(Buffer.from(await store.get("a/1.bin")), image);
    await store.delete("a/1.bin");
    assert.strictEqual(saved.size, 0);
  });

  test("R2 driver refuses to run without its own bucket", () => {
    assert.throws(() => createR2Store({ client: {}, bucket: "", keys }));
  });
});

describe("AI process manager", () => {
  const plan = { command: "python", args: [], cwd: ".", env: {} };

  const fakeSpawn = () => {
    const children = [];
    const spawn = () => {
      const child = new EventEmitter();
      child.pid = 100 + children.length;
      child.kill = () => {
        child.killed = true;
        child.emit("exit", null, "SIGTERM");
      };
      children.push(child);
      return child;
    };
    return { children, spawn };
  };

  test("it passes only what the AI needs: no database URL, JWT or other secrets", () => {
    const launch = resolveAiLaunch(
      { url: "http://127.0.0.1:8018", token: "t", managed: true },
      "/api",
      "linux",
      { PATH: "/bin", DATABASE_URL: "secret", JWT_ACCESS_SECRET: "secret", GEMINI_API_KEY: "secret", PROCTORING_EVIDENCE_KEYS: "secret", AWS_SECRET_ACCESS_KEY: "secret" },
      42
    );
    assert.strictEqual(launch.env.PATH, "/bin");
    assert.strictEqual(launch.env.AI_SERVICE_TOKEN, "t");
    assert.strictEqual(launch.env.AI_PORT, "8018");
    for (const name of ["DATABASE_URL", "JWT_ACCESS_SECRET", "GEMINI_API_KEY", "PROCTORING_EVIDENCE_KEYS", "AWS_SECRET_ACCESS_KEY"]) {
      assert.strictEqual(launch.env[name], undefined, name);
    }
    assert.ok(launch.args.includes("--parent-pid") && launch.args.includes("42"));
  });

  test("it does not manage what it should not", () => {
    const go = (config) => resolveAiLaunch(config, "/api", "linux", {}, 1);
    assert.deepStrictEqual(go({ url: null, token: null, managed: true }), { skip: "NOT_CONFIGURED" });
    assert.deepStrictEqual(go({ url: "http://127.0.0.1:1", token: "t", managed: false }), { skip: "DISABLED" });
    assert.deepStrictEqual(go({ url: "https://ai.example.com", token: "t", managed: true }), { skip: "EXTERNAL" }, "a separate AI server later needs no code change");
  });

  test("AI_PYTHON overrides the interpreter", () => {
    const launch = resolveAiLaunch({ url: "http://127.0.0.1:1", token: "t", managed: true, python: "C:/py/python.exe" }, "/api", "win32", {}, 1);
    assert.strictEqual(launch.command, "C:/py/python.exe");
  });

  test("a crash restarts with backoff, and a crash loop stops and says so", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const { children, spawn } = fakeSpawn();
    const warnings = [];
    const manager = new AiProcessManager(plan, { spawn, health: async () => true, warn: (m) => warnings.push(m), info: () => {} });
    manager.start();
    for (let i = 0; i < 5; i += 1) {
      children[children.length - 1].emit("exit", 1, null);
      t.mock.timers.tick(30_000);
    }
    assert.strictEqual(children.length, 6);
    children[children.length - 1].emit("exit", 1, null);
    t.mock.timers.tick(60_000);
    assert.strictEqual(children.length, 6, "no restart after the crash loop");
    assert.ok(warnings.some((w) => /crash loop/.test(w)));
    manager.stop();
  });

  test("a hung process is replaced after three failed health checks", async () => {
    const { children, spawn } = fakeSpawn();
    const manager = new AiProcessManager(plan, { spawn, health: async () => false, warn: () => {}, info: () => {} });
    manager.launch();
    for (let i = 0; i < 3; i += 1) await manager.healthRound();
    assert.strictEqual(children[0].killed, true);
    manager.stop();
  });

  test("stop does not restart", () => {
    const { children, spawn } = fakeSpawn();
    const manager = new AiProcessManager(plan, { spawn, health: async () => true, warn: () => {}, info: () => {} });
    manager.start();
    manager.stop();
    assert.strictEqual(children.length, 1);
  });

  test("a missing Python environment warns and never throws", async () => {
    const warnings = [];
    const manager = await startManagedAi({ plan, health: async () => false, exists: () => false, warn: (m) => warnings.push(m), info: () => {} });
    assert.strictEqual(manager, null);
    assert.ok(warnings.some((w) => /Python environment is missing/.test(w)));
  });

  test("an AI process already running is used, not replaced", async () => {
    const { children, spawn } = fakeSpawn();
    const manager = await startManagedAi({ plan, health: async () => true, exists: () => true, spawn, warn: () => {}, info: () => {} });
    assert.strictEqual(manager, null);
    assert.strictEqual(children.length, 0);
  });
});
