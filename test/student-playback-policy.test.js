/**
 * Student-only single-playback policy (2026-10-21, config/accessPolicy.js):
 *
 *  - every role may be signed in on several devices; a second device's
 *    sign-in never refuses and never ends the first;
 *  - a STUDENT account plays protected video on one device at a time — a
 *    second device gets 409 PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE until the first
 *    device's lease is released or expires;
 *  - ADMIN and INSTRUCTOR take no playback lease and are never blocked.
 *
 * Mock-only. The real session and playback services run against an
 * in-memory store that enforces the same partial unique indexes as
 * PostgreSQL ("AuthSession_one_active_per_device",
 * "PlaybackLease_one_active_per_user", device-key and token-hash uniqueness)
 * and rolls a transaction back when it throws. Its isolation is weaker than
 * PostgreSQL's (writes are visible before commit), so the concurrency tests
 * here show the services rely on the unique index, not on timing; the
 * database-level proof is session-playback.integration.test.js, which needs
 * TEST_DATABASE_URL.
 *
 * DATABASE_URL is pointed at a closed local port BEFORE anything loads, so a
 * missed stub fails fast instead of reaching a real (shared) database.
 */
process.env.DATABASE_URL = "postgresql://mock:mock@127.0.0.1:1/never";
delete process.env.TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = "student-playback-policy-secret";

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const prisma = require("../src/config/database");
const sessionService = require("../src/modules/sessions/session.service");
const playbackService = require("../src/modules/playback/playback.service");
const progressService = require("../src/modules/progress/progress.service");
const { requiresPlaybackLease } = require("../src/config/accessPolicy");
const { AUTH_ERRORS } = require("../src/utils/authErrors");
const app = require("../src/app");

const EXACT_CONFLICT_MESSAGE =
  "This account is already watching on another device. Stop playback on that device to continue watching here.";

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const TABLES = ["authSession", "device", "playbackLease", "auditEvent"];
const METHODS = ["findUnique", "findFirst", "findMany", "create", "createMany", "update", "updateMany"];

let db;
let seq = 0;
// "perDevice" once scripts/auth-sessions-per-device.sql is applied; "perUser"
// is the index it replaces (the build before that SQL).
let sessionIndex = "perDevice";

const resetDb = () => {
  db = { authSession: [], device: [], playbackLease: [], auditEvent: [], users: new Map(), contents: new Map(), profiles: new Map() };
  sessionIndex = "perDevice";
};

const tick = () => new Promise((resolve) => setImmediate(resolve));
const asTime = (value) => (value instanceof Date ? value.getTime() : value);

function matchValue(actual, condition) {
  if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
    if ("in" in condition && !condition.in.includes(actual)) return false;
    if ("not" in condition && asTime(actual) === asTime(condition.not)) return false;
    if ("lte" in condition && !(asTime(actual) <= asTime(condition.lte))) return false;
    if ("lt" in condition && !(asTime(actual) < asTime(condition.lt))) return false;
    if ("gt" in condition && !(asTime(actual) > asTime(condition.gt))) return false;
    if ("gte" in condition && !(asTime(actual) >= asTime(condition.gte))) return false;
    return true;
  }
  return asTime(actual) === asTime(condition);
}

function matches(table, row, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (condition === undefined) return true;
    if (key === "OR") return condition.some((branch) => matches(table, row, branch));
    if (key === "userId_deviceKeyHash") return row.userId === condition.userId && row.deviceKeyHash === condition.deviceKeyHash;
    if (table === "playbackLease" && key === "session") {
      const session = db.authSession.find((s) => s.id === row.sessionId);
      return Boolean(session) && matches("authSession", session, condition);
    }
    return matchValue(row[key], condition);
  });
}

const uniqueViolation = (target) => Object.assign(new Error("Unique constraint failed"), { code: "P2002", meta: { target } });

function assertUnique(table) {
  const rows = db[table];
  const clash = (keyOf) => {
    const seen = new Set();
    for (const row of rows) {
      const key = keyOf(row);
      if (key === null) continue;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  };
  if (table === "authSession") {
    if (clash((s) => s.tokenHash)) throw uniqueViolation(["tokenHash"]);
    if (sessionIndex === "perDevice" && clash((s) => (s.status === "ACTIVE" ? `${s.userId}|${s.deviceId}` : null))) {
      throw uniqueViolation(["userId", "deviceId"]);
    }
    if (sessionIndex === "perUser" && clash((s) => (s.status === "ACTIVE" ? s.userId : null))) {
      throw uniqueViolation(["userId"]);
    }
  }
  if (table === "device" && clash((d) => `${d.userId}|${d.deviceKeyHash}`)) throw uniqueViolation(["userId", "deviceKeyHash"]);
  if (table === "playbackLease" && clash((l) => (l.status === "ACTIVE" ? l.userId : null))) throw uniqueViolation(["userId"]);
}

function shape(table, row, { include, select } = {}) {
  if (!row) return null;
  if (select) return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
  const out = { ...row };
  if (table === "authSession" && include) {
    if (include.device) out.device = db.device.find((d) => d.id === row.deviceId) || null;
    if (include.user) out.user = db.users.get(row.userId) || null;
  }
  return out;
}

const DEFAULTS = {
  authSession: () => ({ status: "ACTIVE", createdAt: new Date(Date.now() + seq), endedAt: null, endReason: null }),
  device: () => ({ revokedAt: null, firstSeenAt: new Date(), lastSeenAt: new Date(), label: null }),
  playbackLease: () => ({ status: "ACTIVE", startedAt: new Date(), stoppedAt: null, stopReason: null }),
  auditEvent: () => ({ createdAt: new Date() }),
};

/** A delegate whose writes are recorded in `journal` (for rollback). */
function delegate(table, journal) {
  const remember = (undo) => journal && journal.push(undo);
  return {
    async findUnique({ where, include, select }) {
      await tick();
      return shape(table, db[table].find((row) => matches(table, row, where)), { include, select });
    },
    async findFirst({ where, include, select } = {}) {
      await tick();
      return shape(table, db[table].find((row) => matches(table, row, where)), { include, select });
    },
    async findMany({ where, include, select, orderBy, take } = {}) {
      await tick();
      let rows = db[table].filter((row) => matches(table, row, where));
      if (orderBy?.createdAt) rows = rows.sort((a, b) => (orderBy.createdAt === "desc" ? -1 : 1) * (a.createdAt - b.createdAt));
      if (take) rows = rows.slice(0, take);
      return rows.map((row) => shape(table, row, { include, select }));
    },
    async create({ data }) {
      await tick();
      seq += 1;
      const row = { ...DEFAULTS[table](), id: `${table}-${seq}`, ...data };
      db[table].push(row);
      try {
        assertUnique(table);
      } catch (error) {
        db[table].splice(db[table].indexOf(row), 1);
        throw error;
      }
      remember(() => db[table].splice(db[table].indexOf(row), 1));
      return { ...row };
    },
    async createMany({ data }) {
      for (const item of data) await this.create({ data: item });
      return { count: data.length };
    },
    async update({ where, data }) {
      await tick();
      const row = db[table].find((r) => matches(table, r, where));
      if (!row) throw Object.assign(new Error("Record not found"), { code: "P2025" });
      const before = { ...row };
      Object.assign(row, data);
      try {
        assertUnique(table);
      } catch (error) {
        Object.assign(row, before);
        throw error;
      }
      remember(() => Object.assign(row, before));
      return { ...row };
    },
    async updateMany({ where, data }) {
      await tick();
      const rows = db[table].filter((r) => matches(table, r, where));
      const befores = rows.map((row) => ({ ...row }));
      rows.forEach((row) => Object.assign(row, data));
      try {
        assertUnique(table);
      } catch (error) {
        rows.forEach((row, i) => Object.assign(row, befores[i]));
        throw error;
      }
      remember(() => rows.forEach((row, i) => Object.assign(row, befores[i])));
      return { count: rows.length };
    },
  };
}

const originals = [];
const stub = (object, key, value) => {
  originals.push([object, key, object[key]]);
  object[key] = value;
};
const restoreAll = () => {
  while (originals.length) {
    const [object, key, value] = originals.pop();
    object[key] = value;
  }
};

// Every other model fails at once instead of trying the (closed) database
// port: a request that gets past the content gate reaches its handler and
// ends there quickly — which is exactly what the gate tests need to see.
const OTHER_METHODS = ["findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany", "count", "aggregate", "groupBy", "create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const handlerReached = async () => {
  throw Object.assign(new Error("HANDLER_REACHED (unstubbed model in this test)"), { code: "HANDLER_REACHED" });
};

function installFakeDb() {
  resetDb();
  for (const model of Object.keys(prisma).filter((k) => !k.startsWith("$") && !k.startsWith("_") && !TABLES.includes(k))) {
    const delegate = prisma[model];
    if (!delegate || typeof delegate.findMany !== "function") continue;
    for (const method of OTHER_METHODS) if (typeof delegate[method] === "function") stub(delegate, method, handlerReached);
  }
  for (const method of ["$queryRaw", "$queryRawUnsafe", "$executeRaw", "$executeRawUnsafe"]) stub(prisma, method, handlerReached);
  for (const table of TABLES) {
    const fake = delegate(table, null);
    for (const method of METHODS) stub(prisma[table], method, fake[method].bind(fake));
  }
  stub(prisma, "$transaction", async (fn) => {
    const journal = [];
    const tx = Object.fromEntries(TABLES.map((table) => [table, delegate(table, journal)]));
    try {
      return await fn(tx);
    } catch (error) {
      while (journal.length) journal.pop()();
      throw error;
    }
  });
  stub(prisma.user, "findUnique", async ({ where }) =>
    where.email ? [...db.users.values()].find((u) => u.email === where.email) || null : db.users.get(where.id) || null);
  stub(prisma.studentProfile, "findUnique", async ({ where }) => db.profiles.get(where.userId) || null);
  stub(prisma.content, "findUnique", async ({ where }) => db.contents.get(where.id) || null);
  // No evaluator accounts here (utils/evaluatorAccess runs in verifyToken).
  stub(prisma.evaluatorAccess, "findUnique", async () => null);
  stub(progressService, "assertCourseProgressAccess", async () => {});
  stub(progressService, "assertContentsAccessible", async () => {});
}

test.beforeEach(installFakeDb);
test.afterEach(restoreAll);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PASSWORD = "Str0ng!Pass";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const PRIVATE_BLOB = "https://store.private.blob.vercel-storage.com/lesson-1.mp4";

function addUser(id, role) {
  db.users.set(id, { id, email: `${id}@example.com`, role, status: "ACTIVE", isVerified: true, password: PASSWORD_HASH, refreshToken: null });
  if (role === "STUDENT") db.profiles.set(id, { id: `profile-${id}` });
  return { id, role };
}

function addVideo(id = "video-1", videoUrl = PRIVATE_BLOB) {
  db.contents.set(id, { id, type: "VIDEO", videoUrl, fileUrl: null, externalUrl: null, module: { courseId: "course-1" } });
  return id;
}

/** Signs `user` in as a fresh browser; returns what that browser holds. */
async function signIn(user, { deviceKey = null, currentRefreshToken = null } = {}) {
  const created = await sessionService.createSession({
    userId: user.id,
    authMethod: "PASSWORD",
    deviceKey,
    currentRefreshToken,
    userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/130",
  });
  return {
    ...user,
    sessionId: created.session.id,
    deviceId: created.session.deviceId,
    deviceKey: deviceKey || created.deviceKey,
    refreshToken: created.refreshToken,
    rotated: created.rotated,
  };
}

/** The request user verifyToken builds, after the real session gate. */
async function requestUser(browser) {
  const session = await sessionService.validateAccess({ sessionId: browser.sessionId, userId: browser.id, deviceKey: browser.deviceKey });
  return { id: browser.id, role: browser.role, sessionId: session.id, deviceId: session.deviceId };
}

const activeSessions = (userId) => db.authSession.filter((s) => s.userId === userId && s.status === "ACTIVE");
const activeLeases = (userId) => db.playbackLease.filter((l) => l.userId === userId && l.status === "ACTIVE");

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.strictEqual(error.code, code);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

test("only STUDENT needs the single playback lease", () => {
  assert.strictEqual(requiresPlaybackLease("STUDENT"), true);
  assert.strictEqual(requiresPlaybackLease("ADMIN"), false);
  assert.strictEqual(requiresPlaybackLease("INSTRUCTOR"), false);
  assert.strictEqual(requiresPlaybackLease(undefined), false);
});

test("the conflict is 409 with the exact required message", () => {
  assert.strictEqual(AUTH_ERRORS.PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE.status, 409);
  assert.strictEqual(AUTH_ERRORS.PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE.message, EXACT_CONFLICT_MESSAGE);
});

// ---------------------------------------------------------------------------
// 1-2. Students sign in on several devices
// ---------------------------------------------------------------------------

test("1. a student signs in on device A and on device B; both sessions are ACTIVE", async () => {
  const student = addUser("student-1", "STUDENT");
  const a = await signIn(student);
  const b = await signIn(student);

  assert.notStrictEqual(a.deviceId, b.deviceId);
  assert.strictEqual(activeSessions(student.id).length, 2);
  await requestUser(a);
  await requestUser(b);
});

test("2. B's sign-in does not end A's session, A's lease, or A's video", async () => {
  const student = addUser("student-1", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const started = await playbackService.startPlayback(await requestUser(a), contentId);

  const b = await signIn(student);

  assert.strictEqual(db.authSession.find((s) => s.id === a.sessionId).status, "ACTIVE");
  assert.strictEqual(db.playbackLease.find((l) => l.id === started.leaseId).status, "ACTIVE");
  await playbackService.heartbeat(await requestUser(a), started.leaseId);
  await requestUser(b);
  assert.ok(!db.auditEvent.some((e) => e.eventType === "SESSION_CONFLICT"));
});

// ---------------------------------------------------------------------------
// 3-5. One playing device per student account
// ---------------------------------------------------------------------------

test("3/4. B cannot start while A holds the lease: 409, exact message, no media", async () => {
  const student = addUser("student-1", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);
  await playbackService.startPlayback(await requestUser(a), contentId);

  await assert.rejects(playbackService.startPlayback(await requestUser(b), contentId), (error) => {
    assert.strictEqual(error.statusCode, 409);
    assert.strictEqual(error.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
    assert.strictEqual(error.message, EXACT_CONFLICT_MESSAGE);
    assert.ok(!JSON.stringify(error).includes("blob.vercel-storage"));
    return true;
  });
  assert.strictEqual(activeLeases(student.id).length, 1);
  assert.strictEqual(activeLeases(student.id)[0].sessionId, a.sessionId);
  // B playing a different item is the same account watching twice: refused.
  addVideo("video-2");
  await expectCode(playbackService.startPlayback(await requestUser(b), "video-2"), "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
});

test("4. over HTTP: B's start is 409 with the exact message and no video URL", async () => {
  const student = addUser("student-1", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const call = async (browser) => {
    const token = jwt.sign({ id: browser.id, email: `${browser.id}@example.com`, role: browser.role, sid: browser.sessionId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/playback/start`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-device-key": browser.deviceKey },
      body: JSON.stringify({ contentId }),
    });
    return { status: response.status, text: await response.text() };
  };
  try {
    const first = await call(a);
    assert.strictEqual(first.status, 201, first.text);
    assert.ok(JSON.parse(first.text).data.media.url.startsWith("/playback/media/"));

    const second = await call(b);
    const body = JSON.parse(second.text);
    assert.strictEqual(second.status, 409);
    assert.strictEqual(body.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
    assert.strictEqual(body.message, EXACT_CONFLICT_MESSAGE);
    assert.strictEqual(body.data, undefined);
    assert.ok(!/blob\.vercel-storage|\/playback\/media\/|leaseId/.test(second.text));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("5a. once A stops, B may play; A's renewals then fail", async () => {
  const student = addUser("student-1", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);
  const aLease = await playbackService.startPlayback(await requestUser(a), contentId);

  await playbackService.stopPlayback(await requestUser(a), { leaseId: aLease.leaseId, reason: "USER_STOPPED" });
  const bLease = await playbackService.startPlayback(await requestUser(b), contentId);

  assert.ok(bLease.leaseId);
  assert.strictEqual(activeLeases(student.id).length, 1);
  assert.strictEqual(activeLeases(student.id)[0].sessionId, b.sessionId);
  await expectCode(playbackService.heartbeat(await requestUser(a), aLease.leaseId), "PLAYBACK_LEASE_LOST");
});

test("5b. once A's lease expires (no heartbeat), B may play", async () => {
  const student = addUser("student-1", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);
  const aLease = await playbackService.startPlayback(await requestUser(a), contentId);

  db.playbackLease.find((l) => l.id === aLease.leaseId).expiresAt = new Date(Date.now() - 1000);
  const bLease = await playbackService.startPlayback(await requestUser(b), contentId);

  assert.ok(bLease.leaseId);
  assert.strictEqual(db.playbackLease.find((l) => l.id === aLease.leaseId).status, "EXPIRED");
  assert.strictEqual(activeLeases(student.id).length, 1);
  await expectCode(playbackService.heartbeat(await requestUser(a), aLease.leaseId), "PLAYBACK_LEASE_LOST");
});

test("5c. A signing out releases the lease, and B may play", async () => {
  const student = addUser("student-1", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);
  await playbackService.startPlayback(await requestUser(a), contentId);

  assert.strictEqual(await sessionService.logout({ sessionId: a.sessionId }), true);
  await playbackService.startPlayback(await requestUser(b), contentId);
  assert.strictEqual(activeLeases(student.id)[0].sessionId, b.sessionId);
  await requestUser(b);
});

// ---------------------------------------------------------------------------
// 6. Concurrency
// ---------------------------------------------------------------------------

test("6. simultaneous starts from several devices grant exactly one student lease", async () => {
  for (let round = 0; round < 10; round += 1) {
    resetDb();
    const student = addUser(`student-${round}`, "STUDENT");
    const contentId = addVideo();
    const browsers = [];
    for (let i = 0; i < 4; i += 1) browsers.push(await requestUser(await signIn(student)));

    const results = await Promise.allSettled(browsers.map((user) => playbackService.startPlayback(user, contentId)));

    const granted = results.filter((r) => r.status === "fulfilled");
    const refused = results.filter((r) => r.status === "rejected");
    assert.strictEqual(granted.length, 1, `round ${round}: exactly one start wins`);
    assert.ok(refused.every((r) => r.reason.code === "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE"), `round ${round}: the rest are 409`);
    assert.strictEqual(activeLeases(student.id).length, 1);
  }
});

test("6. the lease index itself refuses a second ACTIVE lease, whatever the service does", async () => {
  const student = addUser("student-1", "STUDENT");
  const base = { userId: student.id, contentId: "video-1", lastHeartbeat: new Date(), expiresAt: new Date(Date.now() + 60000) };
  await prisma.playbackLease.create({ data: { ...base, sessionId: "s1", deviceId: "d1" } });
  await assert.rejects(prisma.playbackLease.create({ data: { ...base, sessionId: "s2", deviceId: "d2" } }), { code: "P2002" });
});

// ---------------------------------------------------------------------------
// 7-9. Staff
// ---------------------------------------------------------------------------

for (const role of ["ADMIN", "INSTRUCTOR"]) {
  test(`${role === "ADMIN" ? 7 : 8}. ${role} may be signed in on several devices at once`, async () => {
    const staff = addUser(`${role.toLowerCase()}-1`, role);
    const browsers = [await signIn(staff), await signIn(staff), await signIn(staff)];

    assert.strictEqual(activeSessions(staff.id).length, 3);
    for (const browser of browsers) await requestUser(browser);

    // Simultaneous sign-ins from new devices all succeed too.
    const more = await Promise.all([signIn(staff), signIn(staff), signIn(staff)]);
    assert.strictEqual(more.length, 3);
    assert.strictEqual(activeSessions(staff.id).length, 6);
  });

  test(`9. ${role} playback is never blocked by another device and takes no lease`, async () => {
    const staff = addUser(`${role.toLowerCase()}-1`, role);
    const contentId = addVideo();
    const a = await requestUser(await signIn(staff));
    const b = await requestUser(await signIn(staff));

    const first = await playbackService.startPlayback(a, contentId);
    const results = await Promise.all([playbackService.startPlayback(b, contentId), playbackService.startPlayback(a, contentId)]);

    for (const started of [first, ...results]) {
      assert.strictEqual(started.leaseId, null);
      assert.strictEqual(started.leaseRequired, false);
      // The source staff already see in content responses — not a lease URL.
      assert.deepStrictEqual(started.media, { kind: "file", url: PRIVATE_BLOB, protected: false });
    }
    assert.strictEqual(db.playbackLease.length, 0);
    await playbackService.heartbeat(a, "anything");
    assert.strictEqual(await playbackService.stopPlayback(a, { leaseId: "anything" }), false);
    assert.strictEqual((await playbackService.getStatus(b)).leaseRequired, false);
  });
}

test("9. a student's lease does not block staff, and staff do not block the student", async () => {
  const student = addUser("student-1", "STUDENT");
  const instructor = addUser("instructor-1", "INSTRUCTOR");
  const contentId = addVideo();

  await playbackService.startPlayback(await requestUser(await signIn(student)), contentId);
  const staff = await playbackService.startPlayback(await requestUser(await signIn(instructor)), contentId);
  assert.strictEqual(staff.leaseId, null);
  assert.strictEqual(activeLeases(student.id).length, 1);
});

test("9. staff still need course access: an instructor without it is refused", async () => {
  const instructor = addUser("instructor-1", "INSTRUCTOR");
  const contentId = addVideo();
  stub(progressService, "assertCourseProgressAccess", async () => {
    throw Object.assign(new Error("You do not own this course."), { statusCode: 403 });
  });
  await expectCode(playbackService.startPlayback(await requestUser(await signIn(instructor)), contentId), "CONTENT_ACCESS_DENIED");
});

// ---------------------------------------------------------------------------
// 10. Existing session behaviour, with several devices
// ---------------------------------------------------------------------------

test("10. logout on A ends only A (and A's lease); B stays signed in", async () => {
  const student = addUser("student-1", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);
  const aLease = await playbackService.startPlayback(await requestUser(a), contentId);

  await sessionService.logout({ refreshToken: a.refreshToken });

  await expectCode(requestUser(a), "SESSION_INVALID");
  await requestUser(b);
  assert.strictEqual(db.playbackLease.find((l) => l.id === aLease.leaseId).status, "STOPPED");
});

for (const reason of ["ROLE_CHANGED", "PASSWORD_RESET"]) {
  test(`10. ${reason} revokes the account's sessions on every device, and the lease`, async () => {
    const student = addUser("student-1", "STUDENT");
    const contentId = addVideo();
    const a = await signIn(student);
    const b = await signIn(student);
    const c = await signIn(student);
    await playbackService.startPlayback(await requestUser(b), contentId);

    const ended = await sessionService.revokeUserSessions(student.id, reason);

    assert.strictEqual(ended.length, 3);
    for (const browser of [a, b, c]) await expectCode(requestUser(browser), "SESSION_INVALID");
    assert.strictEqual(activeLeases(student.id).length, 0);
    assert.ok(db.auditEvent.some((e) => e.eventType === "SESSION_REVOKED" && e.reasonCode === reason));
  });
}

test("10. suspending the account signs out every device", async () => {
  const student = addUser("student-1", "STUDENT");
  const a = await signIn(student);
  const b = await signIn(student);
  db.users.get(student.id).status = "SUSPENDED";

  await expectCode(requestUser(a), "ACCOUNT_SUSPENDED");
  await expectCode(requestUser(b), "SESSION_INVALID");
  assert.strictEqual(activeSessions(student.id).length, 0);
});

test("10. the same browser re-signing in with its credential rotates in place", async () => {
  const student = addUser("student-1", "STUDENT");
  const a = await signIn(student);
  const again = await signIn(student, { deviceKey: a.deviceKey, currentRefreshToken: a.refreshToken });

  assert.strictEqual(again.rotated, true);
  assert.strictEqual(again.sessionId, a.sessionId);
  assert.strictEqual(activeSessions(student.id).length, 1);
});

test("10. the same browser without its credential replaces only its own session", async () => {
  const student = addUser("student-1", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);
  const aLease = await playbackService.startPlayback(await requestUser(a), contentId);

  const aAgain = await signIn(student, { deviceKey: a.deviceKey });

  assert.notStrictEqual(aAgain.sessionId, a.sessionId);
  assert.strictEqual(aAgain.deviceId, a.deviceId);
  const old = db.authSession.find((s) => s.id === a.sessionId);
  assert.strictEqual(old.status, "REVOKED");
  assert.strictEqual(old.endReason, "REPLACED_ON_DEVICE");
  assert.strictEqual(db.playbackLease.find((l) => l.id === aLease.leaseId).status, "STOPPED");
  await requestUser(b);
  await requestUser(aAgain);
  assert.strictEqual(activeSessions(student.id).length, 2);
});

test("10. two simultaneous sign-ins from the SAME browser leave one ACTIVE session there", async () => {
  const student = addUser("student-1", "STUDENT");
  const a = await signIn(student);

  const results = await Promise.allSettled([
    signIn(student, { deviceKey: a.deviceKey }),
    signIn(student, { deviceKey: a.deviceKey }),
    signIn(student, { deviceKey: a.deviceKey }),
  ]);

  const onDevice = activeSessions(student.id).filter((s) => s.deviceId === a.deviceId);
  assert.strictEqual(onDevice.length, 1);
  assert.ok(results.some((r) => r.status === "fulfilled"));
  for (const r of results.filter((x) => x.status === "rejected")) {
    assert.strictEqual(r.reason.code, "SESSION_ALREADY_ACTIVE");
    assert.strictEqual(r.reason.message, "This browser is already signing in. Please wait a moment and try again.");
  }
});

// Reproduces the reported screenshot: the new code allows device B, but a
// database still carrying "AuthSession_one_active_per_user" rejects the
// insert. The refusal must name the real cause (server log + message), never
// tell the student to sign out on their other device, and leave A alone.
const LEGACY_INDEX_ERRORS = {
  "fields target": () => uniqueViolation(["userId"]),
  "index-name target": () => uniqueViolation("AuthSession_one_active_per_user"),
  "no target, name in message": () =>
    Object.assign(new Error("Unique constraint failed on the constraint: `AuthSession_one_active_per_user`"), { code: "P2002", meta: {} }),
};
for (const [variant, makeError] of Object.entries(LEGACY_INDEX_ERRORS)) {
  test(`10. old per-user index still in the database (${variant}): B is refused with the real cause, A untouched`, async () => {
    const student = addUser("student-1", "STUDENT");
    const a = await signIn(student);
    stub(prisma, "$transaction", async () => { throw makeError(); });
    const logged = [];
    stub(console, "error", (...args) => logged.push(args.join(" ")));

    await assert.rejects(signIn(student), (error) => {
      assert.strictEqual(error.statusCode, 409);
      assert.strictEqual(error.code, "SESSION_ALREADY_ACTIVE");
      assert.strictEqual(error.message, "Signing in on more than one device is not enabled on this server yet. Please contact your administrator.");
      assert.ok(!/sign out there|another device\. Sign out/i.test(error.message));
      return true;
    });
    assert.ok(logged.some((line) => line.includes("scripts/auth-sessions-per-device.sql")), "the server log names the missing SQL");
    assert.ok(db.auditEvent.some((e) => e.eventType === "SESSION_CONFLICT" && e.reasonCode === "PER_DEVICE_INDEX_MISSING"));
    assert.strictEqual(db.authSession.find((s) => s.id === a.sessionId).status, "ACTIVE");
  });
}

test("10. with the old index modelled in the store, the second device is refused (pre-SQL behaviour)", async () => {
  const student = addUser("student-1", "STUDENT");
  await signIn(student);
  sessionIndex = "perUser";
  stub(console, "error", () => {});

  await expectCode(signIn(student), "SESSION_ALREADY_ACTIVE");
  assert.strictEqual(activeSessions(student.id).length, 1);

  // ...and once the per-device index replaces it, the same sign-in succeeds.
  sessionIndex = "perDevice";
  await signIn(student);
  assert.strictEqual(activeSessions(student.id).length, 2);
});

test("10. a same-browser race is told to wait, not to sign out elsewhere", () => {
  assert.strictEqual(AUTH_ERRORS.SESSION_ALREADY_ACTIVE.message, "This browser is already signing in. Please wait a moment and try again.");
});

test("10. the admin session list shows every ACTIVE device, even behind many ended sessions", async () => {
  const student = addUser("student-1", "STUDENT");
  const first = await signIn(student);
  for (let i = 0; i < 12; i += 1) {
    const extra = await signIn(student);
    await sessionService.logout({ sessionId: extra.sessionId });
  }
  const last = await signIn(student);

  const listed = await sessionService.listUserSessions(student.id);
  const activeIds = listed.filter((s) => s.status === "ACTIVE").map((s) => s.id);
  assert.deepStrictEqual(new Set(activeIds), new Set([first.sessionId, last.sessionId]));
  assert.ok(listed.every((s) => !("tokenHash" in s)));
});

// ---------------------------------------------------------------------------
// The reported screen, end to end: POST /auth/login from two browsers for
// every role, through the real route (rate limiter, Joi, controller,
// authService.login, createSession), then playback from both.
// ---------------------------------------------------------------------------

test("login over HTTP: STUDENT, ADMIN and INSTRUCTOR all sign in on two browsers; only the student's second playback is refused", async () => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, body, { token, deviceKey } = {}) => {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(deviceKey ? { "x-device-key": deviceKey } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: response.status, text: await response.text() };
  };
  const contentId = addVideo();
  try {
    for (const role of ["STUDENT", "ADMIN", "INSTRUCTOR"]) {
      const user = addUser(`${role.toLowerCase()}-login`, role);
      const email = `${user.id}@example.com`;

      // Browser A, then browser B (no device key: a different browser).
      const loginA = await post("/auth/login", { email, password: PASSWORD });
      const loginB = await post("/auth/login", { email, password: PASSWORD });
      assert.strictEqual(loginA.status, 200, `${role} A: ${loginA.text}`);
      assert.strictEqual(loginB.status, 200, `${role} B is never refused at sign-in: ${loginB.text}`);
      assert.ok(!/not enabled on this server|signed in on another device/i.test(loginB.text));
      const a = JSON.parse(loginA.text).data;
      const b = JSON.parse(loginB.text).data;
      assert.notStrictEqual(a.deviceKey, b.deviceKey);

      // A was not signed out by B; both sessions pass the real session gate.
      assert.strictEqual(activeSessions(user.id).length, 2, `${role}: two ACTIVE sessions`);
      for (const browser of [a, b]) {
        const decoded = jwt.decode(browser.accessToken);
        await sessionService.validateAccess({ sessionId: decoded.sid, userId: user.id, deviceKey: browser.deviceKey });
      }

      // Playback: A starts, then B tries.
      const startA = await post("/playback/start", { contentId }, { token: a.accessToken, deviceKey: a.deviceKey });
      const startB = await post("/playback/start", { contentId }, { token: b.accessToken, deviceKey: b.deviceKey });
      assert.strictEqual(startA.status, 201, `${role} A plays: ${startA.text}`);
      if (role === "STUDENT") {
        const body = JSON.parse(startB.text);
        assert.strictEqual(startB.status, 409);
        assert.strictEqual(body.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
        assert.strictEqual(body.message, EXACT_CONFLICT_MESSAGE);
        assert.ok(!/blob\.vercel-storage|\/playback\/media\//.test(startB.text), "no video URL in the refusal");
        assert.strictEqual(activeLeases(user.id).length, 1);
      } else {
        assert.strictEqual(startB.status, 201, `${role} B plays too: ${startB.text}`);
        assert.strictEqual(JSON.parse(startB.text).data.leaseRequired, false);
        assert.strictEqual(activeLeases(user.id).length, 0, `${role} takes no lease`);
      }
      // Still both signed in after the playback attempt.
      assert.strictEqual(activeSessions(user.id).length, 2);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
// Option B: a STUDENT's course content follows the playback lease. While
// device A holds it, the account's other devices get no course content and
// cannot act on it (409 CONTENT_ACTIVE_ON_ANOTHER_DEVICE). A keeps access.
// ---------------------------------------------------------------------------

const CONTENT_BLOCKED = "CONTENT_ACTIVE_ON_ANOTHER_DEVICE";
const CONTENT_BLOCK_MESSAGE =
  "This account is currently active on another device. Stop playback on that device to access course content here.";

// Every API route that serves course content to a student, or acts on it.
const GATED_ROUTES = [
  ["GET", "/courses/course-1"],
  ["GET", "/modules?courseId=course-1"],
  ["GET", "/modules/m1"],
  ["GET", "/lessons?moduleId=m1"],
  ["GET", "/lessons/l1"],
  ["GET", "/lessons/l1/transcript"],
  ["GET", "/topics?lessonId=l1"],
  ["GET", "/topics/t1"],
  ["GET", "/subtopics?topicId=t1"],
  ["GET", "/subtopics/s1"],
  ["GET", "/concepts?subTopicId=s1"],
  ["GET", "/concepts/k1"],
  ["GET", "/contents?lessonId=l1"],
  ["GET", "/contents/video-1"],
  ["GET", "/progress/learning-sequence?courseId=course-1"],
  ["GET", "/progress/learning-path?courseId=course-1"],
  ["POST", "/progress/visit", {}],
  ["POST", "/progress/content-complete", {}],
  ["POST", "/progress/complete", {}],
  ["GET", "/quizzes?courseId=course-1"],
  ["GET", "/quizzes/q1"],
  ["GET", "/quizzes/q1/result"],
  ["POST", "/quizzes/q1/submit", {}],
  ["GET", "/assignments/a1"],
  ["POST", "/assignments/a1/submit", {}],
  ["GET", "/assignments"],
  ["GET", "/quizzes/my-submissions"],
  ["POST", "/quizzes/self-generate", {}],
  ["GET", "/questions"],
  ["GET", "/questions/quiz/q1"],
  ["GET", "/questions/question/qst1"],
  ["GET", "/notes"],
  ["GET", "/notes/n1"],
  ["POST", "/notes", {}],
  ["PUT", "/notes/n1", {}],
  ["PATCH", "/notes/n1/star", {}],
  ["DELETE", "/notes/n1"],
  ["GET", "/bookmarks"],
  ["POST", "/bookmarks", {}],
  ["DELETE", "/bookmarks/b1"],
  ["GET", "/sticky-notes"],
  ["GET", "/sticky-notes/sn1"],
  ["POST", "/sticky-notes", {}],
  ["PUT", "/sticky-notes/sn1", {}],
  ["PATCH", "/sticky-notes/sn1/pin", {}],
  ["DELETE", "/sticky-notes/sn1"],
  ["GET", "/lesson-queries/my-questions"],
  ["POST", "/lesson-queries", {}],
  ["GET", "/discussions"],
  ["POST", "/discussions", {}],
  ["POST", "/discussions/d1/replies", {}],
  ["DELETE", "/discussions/d1"],
  ["GET", "/progress/courses/course-1"],
  ["GET", "/progress"],
  ["PATCH", "/enrollments/course-1/access", {}],
  ["GET", "/learner-model"],
  ["GET", "/learner-model/next-action"],
  ["GET", "/learner-model/recommendations"],
  ["GET", "/learner-model/signals"],
  ["POST", "/learner-model/initialize", {}],
  ["POST", "/learner-model/evidence", {}],
  ["POST", "/learner-model/misconception", {}],
  ["POST", "/learner-model/decision", {}],
  ["POST", "/adaptive-learning/respond", {}],
  ["POST", "/adaptive-learning/respond/stream", {}],
  ["POST", "/adaptive-learning/verification/generate", {}],
  ["POST", "/adaptive-learning/verification/evaluate", {}],
  ["POST", "/ai-assistant/conversations", {}],
  ["GET", "/ai-assistant/conversations"],
  ["PATCH", "/ai-assistant/conversations/c1", {}],
  ["DELETE", "/ai-assistant/conversations/c1"],
  ["GET", "/uploads/contents/lesson1.pdf"],
  ["GET", "/uploads/attachments/rubric.docx"],
  ["GET", "/students/state"],
  ["POST", "/students/state", {}],
  ["POST", "/ai-assistant/guest/messages/stream", {}],
  ["GET", "/ai-assistant/conversations/c1/messages"],
  ["POST", "/ai-assistant/conversations/c1/messages/stream", {}],
];

async function withServer(fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Calls the real API as `browser` (its own token, session and device key). */
const callAs = (base, browser) => async (method, path, body) => {
  const token = jwt.sign(
    { id: browser.id, email: `${browser.id}@example.com`, role: browser.role, sid: browser.sessionId },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: "5m" }
  );
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-device-key": browser.deviceKey },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* a stream or an html error page */ }
    return { status: response.status, text, json };
  } catch (error) {
    // A streaming handler that got past the gate may hold the line open.
    return { status: 0, text: String(error?.name || error), json: null };
  }
};

const isContentBlock = (r) => r.status === 409 && r.json?.code === CONTENT_BLOCKED;
// Got past the gate and authentication: the handler (or its body validation)
// answered. A 401/403 or a timeout would mean the request never got there.
const passedGate = (r) => !isContentBlock(r) && ![0, 401, 403].includes(r.status);

async function studentWithTwoDevices() {
  const student = addUser("student-content", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);
  return { student, contentId, a, b };
}

test("Option B 3/4. while A holds the lease, B is refused on EVERY course-content route: 409, exact message, no content", async () => {
  const { contentId, a, b } = await studentWithTwoDevices();
  await playbackService.startPlayback(await requestUser(a), contentId);
  stub(console, "error", () => {});

  await withServer(async (base) => {
    const asB = callAs(base, b);
    for (const [method, path, body] of GATED_ROUTES) {
      const r = await asB(method, path, body);
      assert.ok(isContentBlock(r), `${method} ${path} → ${r.status} ${r.text.slice(0, 120)}`);
      assert.strictEqual(r.json.message, CONTENT_BLOCK_MESSAGE, `${method} ${path}`);
      assert.strictEqual(r.json.data, undefined, `${method} ${path} carries no data`);
      assert.ok(!/blob\.vercel-storage|youtu|\/playback\/media\//.test(r.text), `${method} ${path} leaks no source`);
    }
    // B is still signed in: the refusal is not a session error.
    await requestUser(b);
  });
});

test("Option B 2. the device holding the lease keeps access: every route passes the gate to its handler", async () => {
  const { contentId, a } = await studentWithTwoDevices();
  await playbackService.startPlayback(await requestUser(a), contentId);
  stub(console, "error", () => {});
  stub(console, "warn", () => {});

  await withServer(async (base) => {
    const asA = callAs(base, a);
    for (const [method, path, body] of GATED_ROUTES) {
      const r = await asA(method, path, body);
      assert.ok(passedGate(r), `${method} ${path} must reach its handler for the lease holder (got ${r.status})`);
    }
  });
});

test("Option B 4. client-supplied ids cannot unlock content: B sending A's session/device/student ids is still refused", async () => {
  const { contentId, a, b, student } = await studentWithTwoDevices();
  await playbackService.startPlayback(await requestUser(a), contentId);
  const spoof = { sessionId: a.sessionId, deviceId: a.deviceId, studentId: `profile-${student.id}`, userId: student.id };

  await withServer(async (base) => {
    const asB = callAs(base, b);
    const qs = new URLSearchParams(spoof).toString();
    assert.ok(isContentBlock(await asB("GET", `/contents/video-1?${qs}`)));
    assert.ok(isContentBlock(await asB("GET", `/progress/learning-sequence?courseId=course-1&${qs}`)));
    assert.ok(isContentBlock(await asB("POST", "/progress/visit", { ...spoof, contentId: "video-1" })));
  });
});

test("Option B 4. B gets no playable source either: /playback/start is refused while A plays", async () => {
  const { contentId, a, b } = await studentWithTwoDevices();
  await playbackService.startPlayback(await requestUser(a), contentId);
  await withServer(async (base) => {
    const r = await callAs(base, b)("POST", "/playback/start", { contentId });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
    assert.ok(!/youtu|\/playback\/media\//.test(r.text));
  });
});

test("Option B 7. once A stops playback, or A's lease expires, B passes the gate again on every route", async () => {
  const { contentId, a, b } = await studentWithTwoDevices();
  stub(console, "error", () => {});
  stub(console, "warn", () => {});

  // Released by A.
  const lease = await playbackService.startPlayback(await requestUser(a), contentId);
  await playbackService.stopPlayback(await requestUser(a), { leaseId: lease.leaseId, reason: "NAVIGATED_AWAY" });
  await withServer(async (base) => {
    const asB = callAs(base, b);
    for (const [method, path, body] of GATED_ROUTES) {
      const r = await asB(method, path, body);
      assert.ok(passedGate(r), `${method} ${path} after release (got ${r.status})`);
    }
  });

  // Expired: A started again and then vanished (no heartbeat for the TTL).
  const again = await playbackService.startPlayback(await requestUser(a), contentId);
  await withServer(async (base) => {
    assert.ok(isContentBlock(await callAs(base, b)("GET", "/contents/video-1")), "blocked while the new lease is live");
    db.playbackLease.find((l) => l.id === again.leaseId).expiresAt = new Date(Date.now() - 1000);
    assert.ok(passedGate(await callAs(base, b)("GET", "/contents/video-1")), "free once it expired");
  });
});

test("Option B 7. a lease whose session has ended does not block the other device", async () => {
  const { contentId, a, b } = await studentWithTwoDevices();
  await playbackService.startPlayback(await requestUser(a), contentId);
  // A session that ended without its lease being stopped.
  db.authSession.find((s) => s.id === a.sessionId).status = "EXPIRED";
  assert.strictEqual(await playbackService.isPlaybackHeldElsewhere(await requestUser(b)), false);
});

test("Option B: the course card (?include=meta) stays available to B; the full course tree does not", async () => {
  const { contentId, a, b } = await studentWithTwoDevices();
  await playbackService.startPlayback(await requestUser(a), contentId);
  stub(console, "error", () => {});
  await withServer(async (base) => {
    const asB = callAs(base, b);
    assert.ok(isContentBlock(await asB("GET", "/courses/course-1")));
    assert.ok(passedGate(await asB("GET", "/courses/course-1?include=meta")));
  });
});

test("Option B 9. ADMIN and INSTRUCTOR are never gated, and the gate does not even look up a lease for them", async () => {
  stub(console, "error", () => {});
  stub(console, "warn", () => {});
  const contentId = addVideo();
  for (const role of ["ADMIN", "INSTRUCTOR"]) {
    const staff = addUser(`${role.toLowerCase()}-content`, role);
    const a = await signIn(staff);
    const b = await signIn(staff);
    await playbackService.startPlayback(await requestUser(a), contentId); // staff take no lease
    const lookups = [];
    const original = prisma.playbackLease.findFirst;
    stub(prisma.playbackLease, "findFirst", async (args) => { lookups.push(args); return original(args); });
    await withServer(async (base) => {
      for (const browser of [a, b]) {
        for (const [method, path, body] of GATED_ROUTES) {
          assert.ok(!isContentBlock(await callAs(base, browser)(method, path, body)), `${role} ${method} ${path}`);
        }
      }
    });
    assert.strictEqual(lookups.length, 0, `${role}: no lease lookup`);
  }
});

test("Option B: a student with no lease anywhere is never gated (two devices browsing, nobody playing)", async () => {
  const { a, b } = await studentWithTwoDevices();
  stub(console, "error", () => {});
  await withServer(async (base) => {
    for (const browser of [a, b]) {
      assert.ok(passedGate(await callAs(base, browser)("GET", "/contents/video-1")));
      assert.ok(passedGate(await callAs(base, browser)("GET", "/progress/learning-sequence?courseId=course-1")));
    }
  });
});

test("Option B 5/6. a page opened before A started playing is refused on its next request, background writes included", async () => {
  const { contentId, a, b } = await studentWithTwoDevices();
  stub(console, "error", () => {});
  await withServer(async (base) => {
    const asB = callAs(base, b);
    assert.ok(passedGate(await asB("GET", "/progress/learning-sequence?courseId=course-1")), "B loaded the page first");
    await playbackService.startPlayback(await requestUser(a), contentId); // A starts afterwards
    assert.ok(isContentBlock(await asB("POST", "/progress/visit", {})), "background progress write refused");
    assert.ok(isContentBlock(await asB("POST", "/students/state", {})), "learning-state sync refused");
    assert.ok(isContentBlock(await asB("GET", "/contents/video-1")), "next content fetch refused");
    // What B's open page re-checks every 30 s: "playing on another device".
    const status = await playbackService.getStatus(await requestUser(b));
    assert.deepStrictEqual([status.active, status.heldByThisDevice], [true, false]);
  });
});

// ---------------------------------------------------------------------------
// Merged from the ayan branch ("Sign out other sessions when the password
// changes"), on the session system: changing the password while signed in
// ends every OTHER session of the account (and its playback lease); the
// device that made the change stays signed in with its current credentials.
// ---------------------------------------------------------------------------

test("change password: the other devices are signed out and lose their lease; this device stays signed in", async () => {
  const student = addUser("student-pw", "STUDENT");
  const contentId = addVideo();
  const a = await signIn(student);
  const b = await signIn(student);
  const c = await signIn(student);
  await playbackService.startPlayback(await requestUser(b), contentId);
  const writes = [];
  stub(prisma.user, "update", async (args) => {
    writes.push(args);
    Object.assign(db.users.get(args.where.id), args.data);
    return db.users.get(args.where.id);
  });

  const NEW_PASSWORD = "N3w-Passw0rd!";
  await withServer(async (base) => {
    const r = await callAs(base, a)("POST", "/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
    assert.strictEqual(r.status, 200, r.text);
    assert.strictEqual(r.json.data.otherSessionsSignedOut, 2);
    assert.ok(!/accessToken|refreshToken/.test(r.text), "no new credentials are issued");
  });

  await requestUser(a); // still signed in, same credentials
  await expectCode(requestUser(b), "SESSION_INVALID");
  await expectCode(requestUser(c), "SESSION_INVALID");
  assert.strictEqual(activeLeases(student.id).length, 0, "the other device's video lease ended with its session");
  assert.ok(db.authSession.filter((s) => s.endReason === "PASSWORD_CHANGED").length === 2);
  assert.ok(db.auditEvent.some((e) => e.eventType === "SESSION_REVOKED" && e.reasonCode === "PASSWORD_CHANGED"));
  assert.ok(await bcrypt.compare(NEW_PASSWORD, writes[0].data.password), "the new password is stored hashed");
});

test("change password: a wrong current password changes nothing and signs nobody out", async () => {
  const student = addUser("student-pw2", "STUDENT");
  const a = await signIn(student);
  const b = await signIn(student);
  stub(prisma.user, "update", async () => { throw new Error("must not write"); });
  stub(console, "error", () => {});

  await withServer(async (base) => {
    const r = await callAs(base, a)("POST", "/auth/change-password", { currentPassword: "Wrong-Passw0rd!", newPassword: "N3w-Passw0rd!" });
    assert.notStrictEqual(r.status, 200);
  });
  await requestUser(a);
  await requestUser(b);
});

// ---------------------------------------------------------------------------
// /uploads: course files on the API's disk follow the same rule, and the
// session is accepted only as headers — never in the URL.
// ---------------------------------------------------------------------------

const fs = require("fs");
const pathLib = require("path");
const UPLOADS_DIR = pathLib.join(__dirname, "../uploads");
const FILE_BYTES = "%PDF-1.4 test bytes";

async function withUploadFile(sub, fn) {
  const dir = pathLib.join(UPLOADS_DIR, sub);
  fs.mkdirSync(dir, { recursive: true });
  const name = `policy-test-${process.pid}-${Date.now()}.pdf`;
  const file = pathLib.join(dir, name);
  fs.writeFileSync(file, FILE_BYTES);
  try {
    return await fn(`/uploads/${sub}/${name}`);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const rawGet = async (base, path, headers = {}) => {
  const response = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(5000) });
  return { status: response.status, text: await response.text(), cacheControl: response.headers.get("cache-control") };
};

const sessionHeaders = (browser) => ({
  authorization: `Bearer ${jwt.sign({ id: browser.id, email: `${browser.id}@example.com`, role: browser.role, sid: browser.sessionId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" })}`,
  "x-device-key": browser.deviceKey,
});

test("uploads: a course file needs a session; A gets the bytes (no-store), B is refused while A plays, an instructor is not limited", async () => {
  const { contentId, a, b } = await studentWithTwoDevices();
  const instructor = await signIn(addUser("instructor-files", "INSTRUCTOR"));
  await playbackService.startPlayback(await requestUser(a), contentId);

  await withUploadFile("contents", (filePath) => withServer(async (base) => {
    const anonymous = await rawGet(base, filePath);
    assert.strictEqual(anonymous.status, 401);
    assert.ok(!anonymous.text.includes("%PDF"), "no bytes without a session");

    const holder = await rawGet(base, filePath, sessionHeaders(a));
    assert.strictEqual(holder.status, 200);
    assert.strictEqual(holder.text, FILE_BYTES);
    assert.strictEqual(holder.cacheControl, "private, no-store");

    const blocked = await rawGet(base, filePath, sessionHeaders(b));
    assert.strictEqual(blocked.status, 409);
    assert.strictEqual(JSON.parse(blocked.text).code, CONTENT_BLOCKED);
    assert.ok(!blocked.text.includes("%PDF"), "no bytes for the blocked device");

    const staff = await rawGet(base, filePath, sessionHeaders(instructor));
    assert.strictEqual(staff.status, 200);
    assert.strictEqual(staff.text, FILE_BYTES);
  }));
});

test("uploads: credentials in the URL are not accepted (they would leak through logs and Referer)", async () => {
  const { a } = await studentWithTwoDevices();
  const headers = sessionHeaders(a);
  const qs = `?token=${encodeURIComponent(headers.authorization.slice(7))}&deviceKey=${encodeURIComponent(a.deviceKey)}`;
  await withUploadFile("attachments", (filePath) => withServer(async (base) => {
    const viaQuery = await rawGet(base, `${filePath}${qs}`);
    assert.strictEqual(viaQuery.status, 401);
    assert.ok(!viaQuery.text.includes("%PDF"));
    // The API's own routes do not take them either.
    const apiViaQuery = await rawGet(base, `/contents/video-1${qs}`);
    assert.strictEqual(apiViaQuery.status, 401);
    assert.strictEqual(JSON.parse(apiViaQuery.text).code, "AUTH_REQUIRED");
  }));
});

test("uploads: public images (avatars, thumbnails) need no session and are not gated", async () => {
  const { contentId, a, b } = await studentWithTwoDevices();
  await playbackService.startPlayback(await requestUser(a), contentId);
  for (const sub of ["avatars", "thumbnails"]) {
    await withUploadFile(sub, (filePath) => withServer(async (base) => {
      const anonymous = await rawGet(base, filePath);
      assert.strictEqual(anonymous.status, 200, sub);
      const blockedDevice = await rawGet(base, filePath, sessionHeaders(b));
      assert.strictEqual(blockedDevice.status, 200, `${sub} is not course content`);
    }));
  }
});
