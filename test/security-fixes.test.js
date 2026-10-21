/**
 * Regression tests for the security and session fixes of 2026-10-21
 * (frontend/lms-web/docs/ORANGE_TREE_LMS_BUG_FIX_REPORT.md): DT-01/DT-02 student IDOR, secret
 * stripping (F-03), optional auth on public routes (DT-10), honest logout
 * (DT-03), session revocation on password reset (F-04) and role change
 * (F-06), unpublished-container detection (DT-06), expiry auditing (DT-08),
 * one write per session touch (DT-07) and media-token log redaction (F-11).
 *
 * Mock-only: every Prisma call on these paths is stubbed. DATABASE_URL is
 * pointed at a closed local port BEFORE anything loads, so a missed stub
 * fails fast instead of reaching a real (shared) database.
 */
process.env.DATABASE_URL = "postgresql://mock:mock@127.0.0.1:1/never";
delete process.env.TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = "security-fixes-test-secret";

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const prisma = require("../src/config/database");
const mail = require("../src/utils/mail");
mail.sendEmail = async () => {};

const sessionService = require("../src/modules/sessions/session.service");
const { stripSecrets } = require("../src/utils/responseSecrets");
const { redactLoggedUrl } = require("../src/utils/logRedaction");
const { optionalToken } = require("../src/middleware/auth.middleware");
const { authError } = require("../src/utils/authErrors");
const progressService = require("../src/modules/progress/progress.service");
const authService = require("../src/modules/auth/auth.service");
const userService = require("../src/modules/users/user.service");
const app = require("../src/app");

// ---------------------------------------------------------------------------
// Harness: real app, real routes and middleware; sessions accepted by stub.
// ---------------------------------------------------------------------------

const DEVICE_KEY = "d".repeat(43);
const USERS = {
  studentA: { id: "user-a", role: "STUDENT", profileId: "profile-a" },
  studentB: { id: "user-b", role: "STUDENT", profileId: "profile-b" },
  admin: { id: "user-admin", role: "ADMIN" },
  instructor: { id: "user-instructor", role: "INSTRUCTOR" },
};
const tokenFor = (who) =>
  jwt.sign({ id: USERS[who].id, email: `${who}@example.com`, role: USERS[who].role, sid: `sid-${who}` }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });

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
test.afterEach(restoreAll);

let server;
test.before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
});
test.after(async () => {
  server.close();
  await prisma.$disconnect().catch(() => {});
});

const call = (method, path, { who, body } = {}) =>
  new Promise((resolve, reject) => {
    const headers = { "Content-Type": "application/json" };
    if (who) {
      headers.Authorization = `Bearer ${tokenFor(who)}`;
      headers["X-Device-Key"] = DEVICE_KEY;
    }
    const req = http.request({ host: "127.0.0.1", port: server.address().port, method, path, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });

const acceptSessions = () =>
  stub(sessionService, "validateAccess", async ({ sessionId }) => ({ id: sessionId, deviceId: `device-${sessionId}` }));

// What the database would hold for a student profile: the full User row,
// secrets included. The stub honours a `select` on `user`, as Prisma does.
const FULL_USER = (id) => ({
  id,
  name: `Name ${id}`,
  email: `${id}@example.com`,
  password: "$2b$10$abcdefghijklmnopqrstuuMOCKHASHmockhashMOCKHASHmo",
  otp: "123456",
  otpExpiresAt: new Date(),
  refreshToken: "legacy-refresh-jwt",
  role: "STUDENT",
  status: "ACTIVE",
});
const project = (row, select) => (select ? Object.fromEntries(Object.keys(select).filter((k) => select[k]).map((k) => [k, row[k]])) : row);

function stubStudentProfiles({ onUpdate } = {}) {
  const byProfile = { "profile-a": "user-a", "profile-b": "user-b" };
  const seen = {};
  stub(prisma.studentProfile, "findUnique", async (args) => {
    if (args.where.userId) {
      const entry = Object.entries(byProfile).find(([, userId]) => userId === args.where.userId);
      return entry ? { id: entry[0] } : null;
    }
    const userId = byProfile[args.where.id];
    if (!userId) return null;
    seen.userSelect = args.include?.user?.select;
    return { id: args.where.id, userId, phone: null, enrollments: [], certificates: [], user: project(FULL_USER(userId), args.include?.user?.select) };
  });
  stub(prisma.studentProfile, "update", async (args) => {
    onUpdate?.(args);
    return { id: args.where.id, ...args.data };
  });
  return seen;
}

const SECRET_KEYS = ["password", "otp", "otpExpiresAt", "tokenHash", "deviceKeyHash"];
const deepKeys = (value, out = new Set()) => {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.add(k); deepKeys(v, out); }
  return out;
};
const assertNoSecrets = (body) => {
  const keys = deepKeys(body);
  for (const key of SECRET_KEYS) assert.ok(!keys.has(key), `response must not contain "${key}"`);
};

// ---------------------------------------------------------------------------
// DT-01 / DT-02 — student profile access control
// ---------------------------------------------------------------------------

test("DT-01: a student cannot read another student's profile", async () => {
  acceptSessions();
  stubStudentProfiles();
  const res = await call("GET", "/students/profile-b", { who: "studentA" });
  assert.strictEqual(res.status, 403);
  assertNoSecrets(res.body);
});

test("DT-01: a student reads their own profile, without any secret fields", async () => {
  acceptSessions();
  const seen = stubStudentProfiles();
  const res = await call("GET", "/students/profile-a", { who: "studentA" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.user.email, "user-a@example.com");
  assertNoSecrets(res.body);
  assert.ok(seen.userSelect && !seen.userSelect.password && !seen.userSelect.otp, "query selects safe user fields only");
});

test("DT-01: admin and instructor still open any student, without secrets", async () => {
  for (const who of ["admin", "instructor"]) {
    acceptSessions();
    stubStudentProfiles();
    const res = await call("GET", "/students/profile-b", { who });
    assert.strictEqual(res.status, 200, `${who} keeps access`);
    assert.strictEqual(res.body.data.user.email, "user-b@example.com");
    assertNoSecrets(res.body);
    restoreAll();
  }
});

test("DT-02: a student cannot update another student's profile, and nothing is written", async () => {
  acceptSessions();
  const writes = [];
  stubStudentProfiles({ onUpdate: (args) => writes.push(args) });
  const res = await call("PUT", "/students/profile-b", { who: "studentA", body: { guardianName: "changed" } });
  assert.strictEqual(res.status, 403);
  assert.strictEqual(writes.length, 0);
});

test("DT-02: a student updates their own allowed fields; protected fields are stripped", async () => {
  acceptSessions();
  const writes = [];
  stubStudentProfiles({ onUpdate: (args) => writes.push(args) });
  const res = await call("PUT", "/students/profile-a", {
    who: "studentA",
    body: { phone: "+911234567890", role: "ADMIN", userId: "user-b", status: "ACTIVE", password: "x" },
  });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(writes[0].where, { id: "profile-a" });
  assert.deepStrictEqual(writes[0].data, { phone: "+911234567890" }, "only the profile field reaches the write");
});

test("DT-02: admin can still update any student; an instructor cannot", async () => {
  acceptSessions();
  const writes = [];
  stubStudentProfiles({ onUpdate: (args) => writes.push(args) });
  const asAdmin = await call("PUT", "/students/profile-b", { who: "admin", body: { guardianName: "set by admin" } });
  assert.strictEqual(asAdmin.status, 200);
  assert.strictEqual(writes.length, 1);
  const asInstructor = await call("PUT", "/students/profile-b", { who: "instructor", body: { guardianName: "nope" } });
  assert.strictEqual(asInstructor.status, 403);
  assert.strictEqual(writes.length, 1);
});

// ---------------------------------------------------------------------------
// F-03 — no secrets in any response, for any role
// ---------------------------------------------------------------------------

test("F-03: responses never carry password hashes, reset codes or credential hashes", () => {
  const body = {
    success: true,
    data: [
      { id: "u1", email: "a@x.io", password: "hash", otp: "111111", otpExpiresAt: "t", refreshToken: "legacy", role: "ADMIN", nested: { tokenHash: "h", deviceKeyHash: "k", keep: 1 } },
    ],
  };
  const out = stripSecrets(body);
  assert.deepStrictEqual(out.data[0], { id: "u1", email: "a@x.io", role: "ADMIN", nested: { keep: 1 } });
  assert.strictEqual(body.data[0].password, "hash", "input not mutated");
});

test("F-03: the login response keeps its refresh credential (only the legacy User column is stripped)", () => {
  const login = { success: true, data: { accessToken: "a", refreshToken: "opaque-session-credential", user: { id: "u", email: "e@x.io", refreshToken: "legacy" } } };
  const out = stripSecrets(login);
  assert.strictEqual(out.data.refreshToken, "opaque-session-credential");
  assert.ok(!("refreshToken" in out.data.user));
});

test("F-03: an ADMIN user lookup through the real route returns no secrets", async () => {
  acceptSessions();
  stub(prisma.user, "findUnique", async () => ({ ...FULL_USER("user-b"), studentProfile: null, teacherProfile: null, adminProfile: null }));
  const res = await call("GET", "/users/user-b", { who: "admin" });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.email, "user-b@example.com");
  assertNoSecrets(res.body);
  assert.ok(!("refreshToken" in res.body.data));
});

// ---------------------------------------------------------------------------
// DT-10 — public routes survive a failed session check
// ---------------------------------------------------------------------------

test("DT-10: optionalToken serves a GUEST when the session check itself fails", async () => {
  stub(sessionService, "validateAccess", async () => { throw new Error("database unavailable"); });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const req = { headers: { authorization: `Bearer ${tokenFor("studentA")}` }, get: () => DEVICE_KEY };
    let nextArg = "not-called";
    await optionalToken(req, {}, (arg) => { nextArg = arg; });
    assert.strictEqual(nextArg, undefined, "no error passed on");
    assert.deepStrictEqual(req.user, { role: "GUEST" });
  } finally {
    console.warn = warn;
  }
});

// ---------------------------------------------------------------------------
// DT-03 — logout reports failure honestly
// ---------------------------------------------------------------------------

test("DT-03: a logout the server could not complete returns 503 LOGOUT_FAILED, not success", async () => {
  stub(sessionService, "logout", async () => { throw new Error("connection reset"); });
  const quiet = [console.warn, console.error];
  console.warn = () => {}; console.error = () => {};
  try {
    const res = await call("POST", "/auth/logout", { who: "studentA", body: { refreshToken: "r".repeat(64) } });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.code, "LOGOUT_FAILED");
    assert.strictEqual(res.body.success, false);
  } finally {
    [console.warn, console.error] = quiet;
  }
});

test("DT-03: logging out an already-ended or unknown session is still a success (idempotent)", async () => {
  stub(sessionService, "logout", async () => false);
  const res = await call("POST", "/auth/logout", { who: "studentA", body: {} });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.success, true);
});

// ---------------------------------------------------------------------------
// F-04 / F-06 — sessions end on password reset and role change
// ---------------------------------------------------------------------------

test("F-04: a password reset ends the account's session (and its lease)", async () => {
  const oldHash = await bcrypt.hash("Old!Passw0rd", 4);
  stub(prisma.user, "findFirst", async () => ({ id: "user-a", email: "a@x.io", password: oldHash, otp: "123456", otpExpiresAt: new Date(Date.now() + 60000) }));
  stub(prisma.user, "update", async () => ({}));
  const revoked = [];
  stub(sessionService, "revokeUserSessions", async (userId, reason) => { revoked.push([userId, reason]); return ["s1"]; });

  await authService.resetPassword("123456", "a@x.io", "New!Passw0rd");
  assert.deepStrictEqual(revoked, [["user-a", "PASSWORD_RESET"]]);
});

test("F-06: changing a user's role ends their session; re-saving the same role does not", async () => {
  const revoked = [];
  stub(sessionService, "revokeUserSessions", async (userId, reason) => { revoked.push([userId, reason]); return []; });
  stub(prisma.user, "findUnique", async () => ({ id: "user-x", role: "INSTRUCTOR", studentProfile: null, teacherProfile: { id: "t" }, adminProfile: { id: "a" } }));
  stub(prisma.user, "update", async (args) => ({ id: "user-x", role: args.data.role }));
  stub(prisma.studentProfile, "create", async () => ({}));

  await userService.updateUserRole("user-x", "STUDENT");
  assert.deepStrictEqual(revoked, [["user-x", "ROLE_CHANGED"]]);
  await userService.updateUserRole("user-x", "INSTRUCTOR");
  assert.strictEqual(revoked.length, 1, "same role: no revocation");
});

// ---------------------------------------------------------------------------
// DT-06 — content under an unpublished container
// ---------------------------------------------------------------------------

test("DT-06: content under an unpublished module, lesson, topic, subtopic or concept is detected", async () => {
  const rows = [
    { id: "ok-course-level", module: null, lesson: null, topic: null, subTopic: null, concept: null },
    { id: "ok-published", lesson: { isPublished: true, module: { isPublished: true } } },
    { id: "lesson-off", lesson: { isPublished: false, module: { isPublished: true } } },
    { id: "module-off", topic: { isPublished: true, lesson: { isPublished: true, module: { isPublished: false } } } },
    { id: "concept-off", concept: { isPublished: false, subTopic: { isPublished: true, topic: { isPublished: true, lesson: { isPublished: true, module: { isPublished: true } } } } } },
  ];
  let query;
  const client = { content: { findMany: async (args) => { query = args; return rows; } } };
  const ids = await progressService.findUnpublishedContentIds(rows.map((r) => r.id), client);
  assert.deepStrictEqual(ids.sort(), ["concept-off", "lesson-off", "module-off"]);
  assert.ok(query.select.concept.select.subTopic.select.topic.select.lesson.select.module, "checks the full chain");
});

// ---------------------------------------------------------------------------
// DT-08 — expiries are audited, in the same transaction
// ---------------------------------------------------------------------------

test("DT-08: expiring a session audits the session and the lease that ended with it", async () => {
  const audit = [];
  const now = new Date();
  const tx = {
    authSession: {
      findMany: async () => [{ id: "s1", userId: "u1", deviceId: "d1" }],
      updateMany: async () => ({ count: 1 }),
    },
    playbackLease: {
      findMany: async () => [{ id: "l1", userId: "u1", sessionId: "s1", deviceId: "d1", contentId: "c1" }],
      updateMany: async () => ({ count: 1 }),
    },
    auditEvent: { createMany: async ({ data }) => { audit.push(...data); return { count: data.length }; } },
  };
  const ids = await sessionService.expireStaleSessions({}, tx, now);
  assert.deepStrictEqual(ids, ["s1"]);
  assert.deepStrictEqual(audit.map((e) => [e.eventType, e.sessionId, e.reasonCode]), [
    ["SESSION_EXPIRED", "s1", "EXPIRED"],
    ["PLAYBACK_LEASE_EXPIRED", "s1", "SESSION_EXPIRED"],
  ]);
});

test("DT-08: when a concurrent call already expired the rows, nothing is audited twice", async () => {
  const audit = [];
  const tx = {
    authSession: { findMany: async () => [{ id: "s1", userId: "u1", deviceId: "d1" }], updateMany: async () => ({ count: 0 }) },
    playbackLease: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    auditEvent: { createMany: async ({ data }) => { audit.push(...data); } },
  };
  await sessionService.expireStaleSessions({}, tx, new Date());
  assert.strictEqual(audit.length, 0);
});

// ---------------------------------------------------------------------------
// DT-07 — one write per session touch
// ---------------------------------------------------------------------------

test("DT-07: a request that refreshes activity writes the session only, not the device", async () => {
  const crypto = require("crypto");
  const session = {
    id: "s1", userId: "user-a", deviceId: "d1", status: "ACTIVE",
    lastSeenAt: new Date(Date.now() - 5 * 60 * 1000),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    absoluteExpiry: new Date(Date.now() + 86400000),
    device: { deviceKeyHash: crypto.createHash("sha256").update(DEVICE_KEY).digest("hex"), revokedAt: null },
    user: { status: "ACTIVE" },
  };
  const writes = [];
  stub(prisma.authSession, "findUnique", async () => session);
  stub(prisma.authSession, "updateMany", async (args) => { writes.push(["session", args.where]); return { count: 1 }; });
  stub(prisma.device, "update", async () => { writes.push(["device"]); return {}; });

  await sessionService.validateAccess({ sessionId: "s1", userId: "user-a", deviceKey: DEVICE_KEY });
  assert.deepStrictEqual(writes, [["session", { id: "s1", status: "ACTIVE" }]]);
});

// ---------------------------------------------------------------------------
// F-11 — signed media tokens stay out of request logs
// ---------------------------------------------------------------------------

test("F-11: the request log redacts the signed media token and nothing else", () => {
  assert.strictEqual(redactLoggedUrl("/playback/media/eyJsIjoi.abc123?x=1"), "/playback/media/[redacted]?x=1");
  assert.strictEqual(redactLoggedUrl("/courses/abc"), "/courses/abc");
  assert.strictEqual(redactLoggedUrl(undefined), undefined);
});

// Sanity: the stubbed session gate is what these tests rely on; a real one
// refusing must still refuse.
test("harness: without an accepted session the student routes refuse", async () => {
  stub(sessionService, "validateAccess", async () => { throw authError("SESSION_INVALID"); });
  const res = await call("GET", "/students/profile-a", { who: "studentA" });
  assert.strictEqual(res.status, 401);
});
