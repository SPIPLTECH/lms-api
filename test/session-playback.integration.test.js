/**
 * Multi-device sign-in, device access control and the single active playback
 * lease for STUDENT accounts (config/accessPolicy.js) — against a real
 * PostgreSQL, because the guarantees under test (partial unique indexes,
 * transactional claims, concurrent sign-ins and starts) only exist in the
 * database.
 *
 * Runs ONLY when TEST_DATABASE_URL is set (config/database.js then points
 * Prisma at it). It never runs against DATABASE_URL. That database must
 * already have scripts/add-auth-sessions-playback.sql AND
 * scripts/auth-sessions-per-device.sql applied:
 *
 *   DATABASE_URL="$TEST_DATABASE_URL" npx prisma db execute --file scripts/add-auth-sessions-playback.sql
 *   DATABASE_URL="$TEST_DATABASE_URL" npx prisma db execute --file scripts/auth-sessions-per-device.sql
 *   TEST_DATABASE_URL=... node --test test/session-playback.integration.test.js
 *
 * Test ids (T-xx) are the technical specification's acceptance criteria.
 * Fixtures are created with unique ids and removed afterwards.
 */
const { describe, test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HAS_TEST_DB = Boolean(process.env.TEST_DATABASE_URL);
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "integration-test-access-secret";

describe("sessions, devices and playback (PostgreSQL)", { skip: HAS_TEST_DB ? false : "TEST_DATABASE_URL not set" }, () => {
  const bcrypt = require("bcrypt");
  const prisma = require("../src/config/database");
  const mail = require("../src/utils/mail");
  mail.sendEmail = async () => {};

  const authService = require("../src/modules/auth/auth.service");
  const sessionService = require("../src/modules/sessions/session.service");
  const playbackService = require("../src/modules/playback/playback.service");
  const app = require("../src/app");

  const RUN = crypto.randomBytes(4).toString("hex");
  const PASSWORD = "Str0ng!Pass";
  const fixtures = {};
  let server;
  let baseUrl;

  const fixtureDir = path.resolve(__dirname, "../uploads/test-fixtures");
  const videoFile = path.join(fixtureDir, `lease-${RUN}.mp4`);
  const VIDEO_BYTES = Buffer.alloc(4096, 7);

  const deviceOf = async (sessionId) =>
    (await prisma.authSession.findUnique({ where: { id: sessionId }, select: { deviceId: true } })).deviceId;

  const contextFor = async (signIn, user = fixtures.student) => ({
    id: user.id,
    role: user.role,
    sessionId: signIn.session.id,
    deviceId: await deviceOf(signIn.session.id),
  });

  const activeSessions = (userId) => prisma.authSession.count({ where: { userId, status: "ACTIVE" } });
  const activeLeases = (userId) => prisma.playbackLease.count({ where: { userId, status: "ACTIVE" } });

  const http = (method, urlPath, { token, deviceKey, body, headers = {} } = {}) =>
    fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(deviceKey ? { "X-Device-Key": deviceKey } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  const signInStudent = (opts = {}) => authService.login(fixtures.student.email, PASSWORD, opts);

  const EXACT_CONFLICT_MESSAGE =
    "This account is already watching on another device. Stop playback on that device to continue watching here.";

  const endAllSessions = async (userId) => {
    await prisma.playbackLease.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "STOPPED", stoppedAt: new Date() } });
    await prisma.authSession.updateMany({ where: { userId, status: "ACTIVE" }, data: { status: "LOGGED_OUT", endedAt: new Date() } });
  };

  const makeUser = async (role, label, extra = {}) => {
    const user = await prisma.user.create({
      data: {
        name: `${label} ${RUN}`,
        // A real TLD: POST /auth/login validates emails (Joi rejects ".local").
        email: `${label.toLowerCase()}-${RUN}@lease-test.example.com`,
        password: await bcrypt.hash(PASSWORD, 4),
        role,
        isVerified: true,
        status: "ACTIVE",
        ...extra,
      },
    });
    if (role === "STUDENT") {
      user.profile = await prisma.studentProfile.create({ data: { userId: user.id } });
    }
    return user;
  };

  before(async () => {
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(videoFile, VIDEO_BYTES);

    fixtures.instructor = await makeUser("INSTRUCTOR", "Instructor");
    fixtures.admin = await makeUser("ADMIN", "Admin");
    fixtures.student = await makeUser("STUDENT", "Student");
    fixtures.outsider = await makeUser("STUDENT", "Outsider");
    fixtures.googleUser = await makeUser("STUDENT", "GoogleUser", { email: `Google.User-${RUN}@Lease-Test.example.com` });

    fixtures.course = await prisma.course.create({
      data: { title: `Lease course ${RUN}`, status: "PUBLISHED", creatorId: fixtures.instructor.id },
    });
    fixtures.video = await prisma.content.create({
      data: { courseId: fixtures.course.id, order: 1, type: "VIDEO", title: "Video 1", videoUrl: `/uploads/test-fixtures/lease-${RUN}.mp4` },
    });
    fixtures.video2 = await prisma.content.create({
      data: { courseId: fixtures.course.id, order: 2, type: "VIDEO", title: "Video 2", videoUrl: "https://youtu.be/abcdefghijk" },
    });
    await prisma.enrollment.create({ data: { studentId: fixtures.student.profile.id, courseId: fixtures.course.id } });
    // Video 1 completed, so the sequence also opens video 2 (lease switching).
    await prisma.contentProgress.create({
      data: { studentId: fixtures.student.profile.id, contentId: fixtures.video.id, visited: true, completed: true, completedAt: new Date() },
    });

    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server?.close();
    const userIds = [fixtures.instructor, fixtures.admin, fixtures.student, fixtures.outsider, fixtures.googleUser].filter(Boolean).map((u) => u.id);
    if (fixtures.course) await prisma.course.delete({ where: { id: fixtures.course.id } }).catch(() => {});
    await prisma.auditEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    fs.rmSync(videoFile, { force: true });
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Multi-device sign-in + device access
  // -------------------------------------------------------------------------

  test("T-01: device A signs in — one ACTIVE session, a device key and an opaque refresh credential", async () => {
    await endAllSessions(fixtures.student.id);
    const a = await signInStudent({ userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0" });
    fixtures.a = a;

    assert.ok(a.accessToken && a.refreshToken && a.deviceKey, "credentials issued");
    assert.strictEqual(await activeSessions(fixtures.student.id), 1);

    const row = await prisma.authSession.findUnique({ where: { id: a.session.id } });
    assert.notStrictEqual(row.tokenHash, a.refreshToken, "only the hash is stored");
    assert.strictEqual(row.tokenHash, crypto.createHash("sha256").update(a.refreshToken).digest("hex"));
  });

  test("T-02: devices B and C sign in too; A's session and credential are untouched", async () => {
    const before = await prisma.authSession.findUnique({ where: { id: fixtures.a.session.id } });
    const b = await signInStudent();
    const c = await signInStudent({ deviceKey: crypto.randomBytes(32).toString("base64url") });

    assert.ok(b.accessToken && b.refreshToken && b.deviceKey, "B gets its own credentials");
    assert.ok(c.deviceKey, "an unknown device key is a new device");
    const afterRow = await prisma.authSession.findUnique({ where: { id: fixtures.a.session.id } });
    assert.strictEqual(afterRow.status, "ACTIVE");
    assert.strictEqual(afterRow.tokenHash, before.tokenHash, "A's credential untouched");
    assert.strictEqual(await activeSessions(fixtures.student.id), 3);
    assert.strictEqual(
      await prisma.auditEvent.count({ where: { userId: fixtures.student.id, eventType: "SESSION_CONFLICT" } }),
      0,
      "a second device is not a conflict"
    );

    const owner = await http("GET", "/sessions/me", { token: fixtures.a.accessToken, deviceKey: fixtures.a.deviceKey });
    assert.strictEqual(owner.status, 200, "A still works");
    await sessionService.logout({ sessionId: b.session.id });
    await sessionService.logout({ sessionId: c.session.id });
  });

  test("T-03: protected APIs refuse no session, and refuse A's token from another device", async () => {
    const none = await http("GET", "/sessions/me");
    assert.strictEqual(none.status, 401);
    assert.strictEqual((await none.json()).code, "AUTH_REQUIRED");

    const foreignDevice = await http("GET", "/sessions/me", { token: fixtures.a.accessToken, deviceKey: crypto.randomBytes(32).toString("base64url") });
    assert.strictEqual(foreignDevice.status, 401);
    const body = await foreignDevice.json();
    assert.strictEqual(body.code, "SESSION_INVALID");
    assert.ok(body.error?.requestId, "error carries a correlation id");

    const noDeviceKey = await http("GET", "/auth/profile", { token: fixtures.a.accessToken });
    assert.strictEqual(noDeviceKey.status, 401);

    const owner = await http("GET", "/sessions/me", { token: fixtures.a.accessToken, deviceKey: fixtures.a.deviceKey });
    assert.strictEqual(owner.status, 200);
    assert.strictEqual((await owner.json()).data.session.id, fixtures.a.session.id);
  });

  test("same device re-auth rotates in place with proof of possession, and replaces its own session without", async () => {
    const rotated = await signInStudent({ deviceKey: fixtures.a.deviceKey, currentRefreshToken: fixtures.a.refreshToken });
    assert.strictEqual(rotated.session.id, fixtures.a.session.id, "same session slot");
    assert.ok(!rotated.deviceKey, "no new device key");
    assert.notStrictEqual(rotated.refreshToken, fixtures.a.refreshToken, "credential rotated");

    await assert.rejects(
      authService.refreshToken(fixtures.a.refreshToken, fixtures.a.deviceKey),
      { code: "SESSION_INVALID" },
      "the pre-rotation credential is dead"
    );
    fixtures.a = { ...fixtures.a, ...rotated, deviceKey: fixtures.a.deviceKey };

    // Same device key, no proof (its storage lost the credential): this
    // browser's previous session is ended and replaced — never a second one.
    const replaced = await signInStudent({ deviceKey: fixtures.a.deviceKey });
    assert.notStrictEqual(replaced.session.id, fixtures.a.session.id);
    assert.strictEqual(await deviceOf(replaced.session.id), await deviceOf(fixtures.a.session.id), "same device row");
    const old = await prisma.authSession.findUnique({ where: { id: fixtures.a.session.id } });
    assert.strictEqual(old.status, "REVOKED");
    assert.strictEqual(old.endReason, "REPLACED_ON_DEVICE");
    fixtures.a = { ...fixtures.a, ...replaced, deviceKey: fixtures.a.deviceKey };
    assert.strictEqual(await activeSessions(fixtures.student.id), 1);
  });

  test("refresh: valid only with the bound device; new access token names the session", async () => {
    const refreshed = await authService.refreshToken(fixtures.a.refreshToken, fixtures.a.deviceKey);
    assert.ok(refreshed.accessToken);
    assert.strictEqual(refreshed.role, "STUDENT");
    const ok = await http("GET", "/auth/profile", { token: refreshed.accessToken, deviceKey: fixtures.a.deviceKey });
    assert.strictEqual(ok.status, 200);

    await assert.rejects(
      authService.refreshToken(fixtures.a.refreshToken, crypto.randomBytes(32).toString("base64url")),
      { code: "SESSION_INVALID" },
      "a copied refresh credential does not work from another browser"
    );
  });

  test("T-04 / T-15: A logs out (twice) — session and lease end; B can then sign in", async () => {
    const ctx = await contextFor(fixtures.a);
    const started = await playbackService.startPlayback(ctx, fixtures.video.id);

    const res1 = await http("POST", "/auth/logout", { token: fixtures.a.accessToken, body: { refreshToken: fixtures.a.refreshToken } });
    const res2 = await http("POST", "/auth/logout", { token: fixtures.a.accessToken, body: { refreshToken: fixtures.a.refreshToken } });
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res2.status, 200, "repeat logout is not an error");

    const session = await prisma.authSession.findUnique({ where: { id: fixtures.a.session.id } });
    assert.strictEqual(session.status, "LOGGED_OUT");
    const lease = await prisma.playbackLease.findUnique({ where: { id: started.leaseId } });
    assert.strictEqual(lease.status, "STOPPED", "logout ends the playback lease in the same transaction");

    const after = await http("GET", "/sessions/me", { token: fixtures.a.accessToken, deviceKey: fixtures.a.deviceKey });
    assert.strictEqual(after.status, 401);

    fixtures.b = await signInStudent();
    assert.strictEqual(await activeSessions(fixtures.student.id), 1);
  });

  test("T-05: simultaneous sign-ins from different devices all succeed, one session each", async () => {
    await endAllSessions(fixtures.student.id);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => signInStudent()));

    const won = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    assert.strictEqual(won.length, 6, "no device is refused");
    assert.strictEqual(await activeSessions(fixtures.student.id), 6);
    assert.strictEqual(new Set(await Promise.all(won.map((s) => deviceOf(s.session.id)))).size, 6, "six devices");

    // Two simultaneous sign-ins from the SAME browser still leave one ACTIVE
    // session on it ("AuthSession_one_active_per_device").
    const sameBrowser = won[0];
    const again = await Promise.allSettled([signInStudent({ deviceKey: sameBrowser.deviceKey }), signInStudent({ deviceKey: sameBrowser.deviceKey })]);
    assert.ok(again.some((r) => r.status === "fulfilled"));
    for (const r of again.filter((x) => x.status === "rejected")) assert.strictEqual(r.reason.code, "SESSION_ALREADY_ACTIVE");
    const deviceId = await deviceOf(sameBrowser.session.id);
    assert.strictEqual(await prisma.authSession.count({ where: { userId: fixtures.student.id, deviceId, status: "ACTIVE" } }), 1);

    await endAllSessions(fixtures.student.id);
    fixtures.b = await signInStudent();
  });

  test("an expired session is reported as SESSION_EXPIRED to its holder and moved out of ACTIVE", async () => {
    await prisma.authSession.update({ where: { id: fixtures.b.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const stale = await http("GET", "/sessions/me", { token: fixtures.b.accessToken, deviceKey: fixtures.b.deviceKey });
    assert.strictEqual(stale.status, 401);
    assert.strictEqual((await stale.json()).code, "SESSION_EXPIRED");

    const c = await signInStudent();
    assert.strictEqual((await prisma.authSession.findUnique({ where: { id: fixtures.b.session.id } })).status, "EXPIRED");
    assert.strictEqual(await activeSessions(fixtures.student.id), 1);
    fixtures.c = c;
  });

  test("absolute lifetime is enforced even with recent activity", async () => {
    await prisma.authSession.update({
      where: { id: fixtures.c.session.id },
      data: { absoluteExpiry: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 600000) },
    });
    await assert.rejects(authService.refreshToken(fixtures.c.refreshToken, fixtures.c.deviceKey), { code: "SESSION_EXPIRED" });
    fixtures.d = await signInStudent();
  });

  // -------------------------------------------------------------------------
  // Playback lease
  // -------------------------------------------------------------------------

  test("T-06: a lease held by A blocks a start from the student's other signed-in device with 409", async () => {
    const owner = await contextFor(fixtures.d);
    const started = await playbackService.startPlayback(owner, fixtures.video.id);
    assert.ok(started.leaseId);
    assert.strictEqual(started.heartbeatIntervalSeconds > 0, true);
    assert.strictEqual(started.media.protected, true);
    fixtures.lease = started;

    // A second device of the same student: signed in, but not allowed to play.
    const other = await signInStudent();
    await assert.rejects(playbackService.startPlayback(await contextFor(other), fixtures.video.id), {
      code: "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE",
      statusCode: 409,
      message: EXACT_CONFLICT_MESSAGE,
    });
    const res = await http("POST", "/playback/start", { token: other.accessToken, deviceKey: other.deviceKey, body: { contentId: fixtures.video.id } });
    const text = await res.text();
    assert.strictEqual(res.status, 409);
    assert.strictEqual(JSON.parse(text).message, EXACT_CONFLICT_MESSAGE);
    assert.ok(!text.includes("/playback/media/") && !text.includes(`lease-${RUN}.mp4`), "no video URL in the refusal");
    assert.strictEqual(await activeLeases(fixtures.student.id), 1);
    await sessionService.logout({ sessionId: other.session.id });
  });

  test("the same session switching videos updates the one lease in place", async () => {
    const owner = await contextFor(fixtures.d);
    const switched = await playbackService.startPlayback(owner, fixtures.video2.id);
    assert.strictEqual(switched.leaseId, fixtures.lease.leaseId);
    assert.deepStrictEqual(switched.media, { kind: "youtube", url: "https://youtu.be/abcdefghijk", protected: false });
    assert.strictEqual(await activeLeases(fixtures.student.id), 1);
    await playbackService.startPlayback(owner, fixtures.video.id);
  });

  test("T-08: heartbeats from the wrong session or device are rejected without extending the lease", async () => {
    const owner = await contextFor(fixtures.d);
    const before = await prisma.playbackLease.findUnique({ where: { id: fixtures.lease.leaseId } });
    for (const wrong of [{ ...owner, sessionId: "x" }, { ...owner, deviceId: "y" }, { ...owner, id: fixtures.outsider.id }]) {
      await assert.rejects(playbackService.heartbeat(wrong, fixtures.lease.leaseId), { code: "PLAYBACK_LEASE_LOST" });
    }
    const after = await prisma.playbackLease.findUnique({ where: { id: fixtures.lease.leaseId } });
    assert.strictEqual(after.expiresAt.getTime(), before.expiresAt.getTime());

    await playbackService.heartbeat(owner, fixtures.lease.leaseId);
    const renewed = await prisma.playbackLease.findUnique({ where: { id: fixtures.lease.leaseId } });
    assert.ok(renewed.expiresAt >= before.expiresAt);
  });

  test("T-11 / media: signed URLs serve only while the lease lives; an unenrolled user gets no URL", async () => {
    const token = fixtures.lease.media.url.split("/").pop();
    const full = await http("GET", `/playback/media/${token}`);
    assert.strictEqual(full.status, 200);
    assert.strictEqual(full.headers.get("cache-control"), "private, no-store");
    assert.strictEqual(Buffer.from(await full.arrayBuffer()).length, VIDEO_BYTES.length);

    const partial = await http("GET", `/playback/media/${token}`, { headers: { Range: "bytes=0-99" } });
    assert.strictEqual(partial.status, 206, "range requests work for seeking");
    assert.strictEqual(Buffer.from(await partial.arrayBuffer()).length, 100);

    const forged = await http("GET", `/playback/media/${token.slice(0, -3)}abc`);
    assert.strictEqual(forged.status, 403);
    assert.strictEqual((await forged.json()).code, "MEDIA_URL_INVALID");

    // Unenrolled student: 403 and no lease, no URL.
    const outsiderSignIn = await authService.login(fixtures.outsider.email, PASSWORD);
    const outsider = await contextFor(outsiderSignIn, fixtures.outsider);
    await assert.rejects(playbackService.startPlayback(outsider, fixtures.video.id), { code: "CONTENT_ACCESS_DENIED", statusCode: 403 });
    assert.strictEqual(await activeLeases(fixtures.outsider.id), 0);
    await sessionService.logout({ sessionId: outsiderSignIn.session.id });
  });

  test("T-09: a stopped lease cannot be renewed or used; stop is idempotent", async () => {
    const owner = await contextFor(fixtures.d);
    await playbackService.stopPlayback(owner, { leaseId: fixtures.lease.leaseId, reason: "USER_STOPPED" });
    await playbackService.stopPlayback(owner, { leaseId: fixtures.lease.leaseId });

    const lease = await prisma.playbackLease.findUnique({ where: { id: fixtures.lease.leaseId } });
    assert.strictEqual(lease.status, "STOPPED");
    await assert.rejects(playbackService.heartbeat(owner, fixtures.lease.leaseId), { code: "PLAYBACK_LEASE_LOST" });
    assert.strictEqual((await prisma.playbackLease.findUnique({ where: { id: fixtures.lease.leaseId } })).status, "STOPPED", "not resurrected");

    const media = await http("GET", fixtures.lease.media.url);
    assert.strictEqual(media.status, 409);
    assert.strictEqual((await media.json()).code, "PLAYBACK_LEASE_LOST");
  });

  test("T-10 / T-13: an abandoned lease expires and another start reclaims it", async () => {
    const owner = await contextFor(fixtures.d);
    const first = await playbackService.startPlayback(owner, fixtures.video.id);
    await prisma.playbackLease.update({ where: { id: first.leaseId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await assert.rejects(playbackService.heartbeat(owner, first.leaseId), { code: "PLAYBACK_LEASE_LOST" });
    assert.strictEqual((await prisma.playbackLease.findUnique({ where: { id: first.leaseId } })).status, "EXPIRED");

    const reclaimed = await playbackService.startPlayback(owner, fixtures.video.id);
    assert.notStrictEqual(reclaimed.leaseId, first.leaseId, "a fresh lease, not the expired one revived");
    assert.strictEqual(await activeLeases(fixtures.student.id), 1);

    // Abandoned without any heartbeat noticing: the next start reclaims it.
    await prisma.playbackLease.update({ where: { id: reclaimed.leaseId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const next = await playbackService.startPlayback(owner, fixtures.video.id);
    assert.notStrictEqual(next.leaseId, reclaimed.leaseId);
    assert.strictEqual((await prisma.playbackLease.findUnique({ where: { id: reclaimed.leaseId } })).status, "EXPIRED");
    const audit = await prisma.auditEvent.count({ where: { userId: fixtures.student.id, eventType: "PLAYBACK_LEASE_RECLAIMED" } });
    assert.ok(audit >= 1, "stale-lease reclaim is audited");
  });

  test("T-07: simultaneous playback starts leave at most one ACTIVE lease", async () => {
    await prisma.playbackLease.updateMany({ where: { userId: fixtures.student.id, status: "ACTIVE" }, data: { status: "STOPPED" } });
    const owner = await contextFor(fixtures.d);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => playbackService.startPlayback(owner, fixtures.video.id)));
    // All from one session/device: they converge on one lease.
    const ids = new Set(results.filter((r) => r.status === "fulfilled").map((r) => r.value.leaseId));
    for (const r of results.filter((r) => r.status === "rejected")) {
      assert.strictEqual(r.reason.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
    }
    assert.ok(ids.size <= 1);
    assert.strictEqual(await activeLeases(fixtures.student.id), 1);
  });

  test("T-07: simultaneous starts from several signed-in devices grant exactly one lease", async () => {
    await prisma.playbackLease.updateMany({ where: { userId: fixtures.student.id, status: "ACTIVE" }, data: { status: "STOPPED" } });
    const others = await Promise.all(Array.from({ length: 4 }, () => signInStudent()));
    const contexts = [await contextFor(fixtures.d), ...(await Promise.all(others.map((s) => contextFor(s))))];

    const results = await Promise.allSettled(contexts.map((ctx) => playbackService.startPlayback(ctx, fixtures.video.id)));
    assert.strictEqual(results.filter((r) => r.status === "fulfilled").length, 1, "one device wins");
    for (const r of results.filter((x) => x.status === "rejected")) assert.strictEqual(r.reason.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
    assert.strictEqual(await activeLeases(fixtures.student.id), 1);

    // Hand the lease back to D for the tests below.
    for (const s of others) await sessionService.logout({ sessionId: s.session.id });
    await prisma.playbackLease.updateMany({ where: { userId: fixtures.student.id, status: "ACTIVE" }, data: { status: "STOPPED" } });
    await playbackService.startPlayback(contexts[0], fixtures.video.id);
  });

  test("GET /playback/status discloses details only to the holding device", async () => {
    const res = await http("GET", "/playback/status", { token: fixtures.d.accessToken, deviceKey: fixtures.d.deviceKey });
    const { data } = await res.json();
    assert.strictEqual(data.active, true);
    assert.strictEqual(data.heldByThisDevice, true);
    assert.ok(data.leaseId);
  });

  test("T-12: when the session expires mid-playback the heartbeat fails and the lease ends", async () => {
    const lease = await prisma.playbackLease.findFirst({ where: { userId: fixtures.student.id, status: "ACTIVE" } });
    await prisma.authSession.update({ where: { id: fixtures.d.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await http("POST", "/playback/heartbeat", { token: fixtures.d.accessToken, deviceKey: fixtures.d.deviceKey, body: { leaseId: lease.id } });
    assert.strictEqual(res.status, 401);
    assert.strictEqual((await res.json()).code, "SESSION_EXPIRED");
    assert.strictEqual((await prisma.playbackLease.findUnique({ where: { id: lease.id } })).status, "EXPIRED");
  });

  // -------------------------------------------------------------------------
  // Revocation and account status
  // -------------------------------------------------------------------------

  test("T-14 / T-16: an admin revocation kills the session and its lease, and is audited", async () => {
    const e = await signInStudent();
    const ctx = await contextFor(e);
    const started = await playbackService.startPlayback(ctx, fixtures.video.id);

    await sessionService.adminRevokeSession(e.session.id, fixtures.instructor.id);

    const res = await http("GET", "/sessions/me", { token: e.accessToken, deviceKey: e.deviceKey });
    assert.strictEqual(res.status, 401);
    assert.strictEqual((await res.json()).code, "SESSION_INVALID");
    assert.strictEqual((await prisma.playbackLease.findUnique({ where: { id: started.leaseId } })).status, "REVOKED");
    await assert.rejects(authService.refreshToken(e.refreshToken, e.deviceKey), { code: "SESSION_INVALID" });

    const audit = await prisma.auditEvent.findFirst({ where: { sessionId: e.session.id, eventType: "SESSION_REVOKED", reasonCode: "ADMIN_REVOKE" } });
    assert.ok(audit, "revocation audit record exists");
    assert.strictEqual(audit.metadata.revokedBy, fixtures.instructor.id);
  });

  // -------------------------------------------------------------------------
  // Google identity linking
  // -------------------------------------------------------------------------

  const googleVerify = (identity) => async () => ({ issuer: "https://accounts.google.com", emailVerified: true, ...identity });

  test("Google: no matching LMS account is 403 ACCOUNT_NOT_ALLOWED and creates nothing", async () => {
    const before = await prisma.user.count();
    await assert.rejects(
      authService.loginWithGoogle("t", { verify: googleVerify({ subject: `nobody-${RUN}`, email: `nobody-${RUN}@x.local` }) }),
      { code: "ACCOUNT_NOT_ALLOWED", statusCode: 403 }
    );
    assert.strictEqual(await prisma.user.count(), before);
  });

  test("Google: an unverified email is never used to link", async () => {
    await assert.rejects(
      authService.loginWithGoogle("t", { verify: googleVerify({ subject: `g-${RUN}`, email: fixtures.googleUser.email, emailVerified: false }) }),
      { code: "ACCOUNT_NOT_ALLOWED" }
    );
    assert.strictEqual(await prisma.userIdentity.count({ where: { userId: fixtures.googleUser.id } }), 0);
  });

  test("Google: first sign-in links by verified email (case-insensitive); later ones use sub only", async () => {
    const subject = `g-${RUN}`;
    const first = await authService.loginWithGoogle("t", { verify: googleVerify({ subject, email: fixtures.googleUser.email.toUpperCase() }) });
    assert.strictEqual(first.user.id, fixtures.googleUser.id);
    const link = await prisma.userIdentity.findUnique({ where: { issuer_subject: { issuer: "https://accounts.google.com", subject } } });
    assert.strictEqual(link.userId, fixtures.googleUser.id);
    assert.strictEqual((await prisma.authSession.findUnique({ where: { id: first.session.id } })).authMethod, "GOOGLE");

    // Google sign-in follows the same multi-device rule: another device is
    // signed in alongside, resolved by (issuer, sub), not by the new email.
    const again = await authService.loginWithGoogle("t", { verify: googleVerify({ subject, email: "changed@elsewhere.local" }) });
    assert.strictEqual(again.user.id, fixtures.googleUser.id, "resolved by (issuer, sub), not by the new email");
    assert.strictEqual((await prisma.authSession.findUnique({ where: { id: first.session.id } })).status, "ACTIVE");
    await sessionService.logout({ sessionId: first.session.id });
    await sessionService.logout({ sessionId: again.session.id });
  });

  test("Google: an account already linked to another Google identity is not relinked", async () => {
    await assert.rejects(
      authService.loginWithGoogle("t", { verify: googleVerify({ subject: `other-${RUN}`, email: fixtures.googleUser.email }) }),
      { code: "ACCOUNT_NOT_ALLOWED" }
    );
  });

  // -------------------------------------------------------------------------
  // Existing behaviour, through the new gate
  // -------------------------------------------------------------------------

  test("regression: a signed-in student still reads their course, sequence and progress; sources are withheld", async () => {
    await endAllSessions(fixtures.student.id);
    const s = await signInStudent();
    const auth = { token: s.accessToken, deviceKey: s.deviceKey };

    const content = await http("GET", `/contents/${fixtures.video.id}`, auth);
    assert.strictEqual(content.status, 200);
    const row = await content.json();
    assert.strictEqual(row.videoUrl, null);
    assert.strictEqual(row.mediaProtected, true);

    const sequence = await http("GET", `/progress/learning-sequence?courseId=${fixtures.course.id}`, auth);
    assert.strictEqual(sequence.status, 200);
    const seq = (await sequence.json()).data;
    const videoStep = seq.steps.find((step) => step.contentId === fixtures.video.id);
    assert.strictEqual(videoStep.body.videoUrl, null);
    assert.strictEqual(videoStep.body.mediaProtected, true);

    const course = await http("GET", `/courses/${fixtures.course.id}`, auth);
    assert.strictEqual(course.status, 200);
    // The fixture video's actual path (test users' emails also contain
    // "lease-", so match the path, not a fragment of it).
    assert.ok(!JSON.stringify(await course.json()).includes(`test-fixtures/lease-${RUN}.mp4`), "no raw video path in the course tree");

    const progress = await http("GET", `/progress/courses/${fixtures.course.id}`, auth);
    assert.strictEqual(progress.status, 200);

    const guest = await http("GET", `/courses/${fixtures.course.id}`);
    assert.ok(!JSON.stringify(await guest.json()).includes("youtu.be"), "guests get no video sources either");
    await sessionService.logout({ sessionId: s.session.id });
  });

  test("regression: an instructor still sees raw sources and role checks are unchanged", async () => {
    const i = await authService.login(fixtures.instructor.email, PASSWORD);
    const auth = { token: i.accessToken, deviceKey: i.deviceKey };

    const content = await http("GET", `/contents/${fixtures.video.id}`, auth);
    assert.strictEqual((await content.json()).videoUrl, `/uploads/test-fixtures/lease-${RUN}.mp4`);

    const adminOnly = await http("GET", "/admin/users", auth);
    assert.strictEqual(adminOnly.status, 403, "INSTRUCTOR is still not ADMIN");
    await sessionService.logout({ sessionId: i.session.id });
  });

  for (const role of ["INSTRUCTOR", "ADMIN"]) {
    test(`staff: ${role} is signed in on several devices and plays on all of them without a lease`, async () => {
      const user = role === "ADMIN" ? fixtures.admin : fixtures.instructor;
      const signIns = await Promise.all(Array.from({ length: 3 }, () => authService.login(user.email, PASSWORD)));
      assert.strictEqual(await activeSessions(user.id), 3);

      const starts = await Promise.all(
        signIns.map((s) => http("POST", "/playback/start", { token: s.accessToken, deviceKey: s.deviceKey, body: { contentId: fixtures.video.id } }))
      );
      for (const res of starts) {
        assert.strictEqual(res.status, 201);
        const { data } = await res.json();
        assert.strictEqual(data.leaseId, null);
        assert.strictEqual(data.leaseRequired, false);
      }
      assert.strictEqual(await activeLeases(user.id), 0, "staff take no lease");
      for (const s of signIns) {
        assert.strictEqual((await http("GET", "/auth/profile", { token: s.accessToken, deviceKey: s.deviceKey })).status, 200);
        await sessionService.logout({ sessionId: s.session.id });
      }
    });
  }

  // -------------------------------------------------------------------------
  // The reported scenario, end to end over HTTP: two browsers, SAME student
  // account, through the real routes (rate limiter, Joi, controller, device
  // key header) exactly as the frontend calls them.
  // -------------------------------------------------------------------------

  test("HTTP: browser B (same student) signs in alongside A but cannot play while A is watching", async () => {
    await endAllSessions(fixtures.student.id);
    const credentials = { email: fixtures.student.email, password: PASSWORD };

    // Browser A signs in and starts the video.
    const loginA = await http("POST", "/auth/login", { body: credentials });
    assert.strictEqual(loginA.status, 200);
    const a = (await loginA.json()).data;
    assert.ok(a.accessToken && a.refreshToken && a.deviceKey);
    const authA = { token: a.accessToken, deviceKey: a.deviceKey };

    const startA = await http("POST", "/playback/start", { ...authA, body: { contentId: fixtures.video.id } });
    assert.strictEqual(startA.status, 201);
    const leaseA = (await startA.json()).data;
    assert.ok(leaseA.leaseId && leaseA.media?.url);

    // Browser B: signs in (not refused, A not signed out).
    const loginB = await http("POST", "/auth/login", { body: credentials });
    assert.strictEqual(loginB.status, 200, "B is not refused at sign-in");
    const b = (await loginB.json()).data;
    const authB = { token: b.accessToken, deviceKey: b.deviceKey };
    assert.strictEqual((await http("GET", "/auth/profile", authB)).status, 200);

    // ...but cannot play while A holds the lease: 409, exact text, no URL.
    const startB = await http("POST", "/playback/start", { ...authB, body: { contentId: fixtures.video.id } });
    const text = await startB.text();
    assert.strictEqual(startB.status, 409);
    const body = JSON.parse(text);
    assert.strictEqual(body.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
    assert.strictEqual(body.error.code, "PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE");
    assert.strictEqual(body.message, EXACT_CONFLICT_MESSAGE);
    assert.ok(!body.data, "no lease and no media for B");
    assert.ok(!text.includes("/playback/media/") && !text.includes(`lease-${RUN}.mp4`), "no video URL in the refusal");

    // A is untouched: still signed in, still holding its lease.
    assert.strictEqual((await http("GET", "/auth/profile", authA)).status, 200);
    const beat = await http("POST", "/playback/heartbeat", { ...authA, body: { leaseId: leaseA.leaseId } });
    assert.strictEqual(beat.status, 204);
    const refreshA = await http("POST", "/auth/refresh-token", { deviceKey: a.deviceKey, body: { refreshToken: a.refreshToken } });
    assert.strictEqual(refreshA.status, 200, "B's sign-in did not invalidate A's refresh credential");
    assert.strictEqual(await activeSessions(fixtures.student.id), 2);
    assert.strictEqual(await activeLeases(fixtures.student.id), 1);

    // A stops: B may play; A, still signed in, is now the one refused.
    const stopA = await http("POST", "/playback/stop", { ...authA, body: { leaseId: leaseA.leaseId, reason: "USER_STOPPED" } });
    assert.strictEqual(stopA.status, 204);
    const startB2 = await http("POST", "/playback/start", { ...authB, body: { contentId: fixtures.video.id } });
    assert.strictEqual(startB2.status, 201);
    const leaseB = (await startB2.json()).data;
    const startA2 = await http("POST", "/playback/start", { ...authA, body: { contentId: fixtures.video.id } });
    assert.strictEqual(startA2.status, 409);
    assert.strictEqual((await http("GET", "/auth/profile", authA)).status, 200, "refused playback is not a sign-out");

    // B's lease is abandoned (no heartbeat): once it expires, A may play.
    await prisma.playbackLease.update({ where: { id: leaseB.leaseId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const startA3 = await http("POST", "/playback/start", { ...authA, body: { contentId: fixtures.video.id } });
    assert.strictEqual(startA3.status, 201);

    for (const s of [a, b]) {
      await http("POST", "/auth/logout", { token: s.accessToken, deviceKey: s.deviceKey, body: { refreshToken: s.refreshToken } });
    }
  });

  test("HTTP: simultaneous logins from different browsers all succeed", async () => {
    await endAllSessions(fixtures.student.id);
    const credentials = { email: fixtures.student.email, password: PASSWORD };
    const responses = await Promise.all(Array.from({ length: 4 }, () => http("POST", "/auth/login", { body: credentials })));
    assert.deepStrictEqual(responses.map((r) => r.status), [200, 200, 200, 200]);
    assert.strictEqual(await activeSessions(fixtures.student.id), 4);
    await endAllSessions(fixtures.student.id);
  });

  test("DT-06: a video in an unpublished lesson cannot be played, even with its id", async () => {
    await endAllSessions(fixtures.student.id);
    const module = await prisma.module.create({ data: { courseId: fixtures.course.id, title: `Draft module ${RUN}`, order: 900, isPublished: true } });
    const lesson = await prisma.lesson.create({ data: { moduleId: module.id, title: `Draft lesson ${RUN}`, order: 1, isPublished: false } });
    const hidden = await prisma.content.create({
      data: { lessonId: lesson.id, order: 1, type: "VIDEO", title: "Unpublished video", videoUrl: "https://youtu.be/abcdefghijk" },
    });

    const s = await signInStudent();
    const ctx = await contextFor(s);
    await assert.rejects(playbackService.startPlayback(ctx, hidden.id), { code: "CONTENT_ACCESS_DENIED", statusCode: 403 });
    assert.strictEqual(await activeLeases(fixtures.student.id), 0, "no lease issued");

    // The published video in the same course still plays.
    const ok = await playbackService.startPlayback(ctx, fixtures.video.id);
    assert.ok(ok.leaseId);

    await sessionService.logout({ sessionId: s.session.id });
    await prisma.module.delete({ where: { id: module.id } });
  });

  test("Option B: while A plays, B (same student) gets no course content; A does; B regains it when A stops", async () => {
    await endAllSessions(fixtures.student.id);
    const a = await signInStudent();
    const b = await signInStudent();
    const authA = { token: a.accessToken, deviceKey: a.deviceKey };
    const authB = { token: b.accessToken, deviceKey: b.deviceKey };
    const routes = [`/contents/${fixtures.video.id}`, `/progress/learning-sequence?courseId=${fixtures.course.id}`, `/courses/${fixtures.course.id}`];

    // Nobody playing: both devices read content.
    for (const path of routes) {
      assert.strictEqual((await http("GET", path, authA)).status, 200, `A ${path}`);
      assert.strictEqual((await http("GET", path, authB)).status, 200, `B ${path}`);
    }

    const start = await http("POST", "/playback/start", { ...authA, body: { contentId: fixtures.video.id } });
    assert.strictEqual(start.status, 201);
    const lease = (await start.json()).data;

    for (const path of routes) {
      const refused = await http("GET", path, authB);
      const text = await refused.text();
      assert.strictEqual(refused.status, 409, `B ${path}`);
      assert.strictEqual(JSON.parse(text).code, "CONTENT_ACTIVE_ON_ANOTHER_DEVICE");
      assert.ok(!text.includes(`lease-${RUN}.mp4`) && !text.includes("Video 1"), `B ${path} carries no content`);
      assert.strictEqual((await http("GET", path, authA)).status, 200, `A keeps ${path}`);
    }
    const visit = await http("POST", "/progress/visit", { ...authB, body: { contentId: fixtures.video.id } });
    assert.strictEqual(visit.status, 409, "B's background progress write is refused");
    assert.strictEqual((await http("GET", `/courses/${fixtures.course.id}?include=meta`, authB)).status, 200, "course card still loads");
    assert.strictEqual((await http("GET", "/auth/profile", authB)).status, 200, "B is still signed in");

    await http("POST", "/playback/stop", { ...authA, body: { leaseId: lease.leaseId, reason: "USER_STOPPED" } });
    for (const path of routes) assert.strictEqual((await http("GET", path, authB)).status, 200, `B ${path} after A stopped`);

    // An instructor is never gated, whatever students are doing.
    const i1 = await authService.login(fixtures.instructor.email, PASSWORD);
    const i2 = await authService.login(fixtures.instructor.email, PASSWORD);
    await http("POST", "/playback/start", { token: i1.accessToken, deviceKey: i1.deviceKey, body: { contentId: fixtures.video.id } });
    assert.strictEqual((await http("GET", `/contents/${fixtures.video.id}`, { token: i2.accessToken, deviceKey: i2.deviceKey })).status, 200);

    for (const s of [a, b, i1, i2]) await sessionService.logout({ sessionId: s.session.id });
  });

  test("cleanup job expires stale rows and is idempotent", async () => {
    await endAllSessions(fixtures.student.id);
    const h = await signInStudent();
    await prisma.authSession.update({ where: { id: h.session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const first = await sessionService.expireAllStale();
    assert.ok(first.sessions >= 1);
    assert.strictEqual((await prisma.authSession.findUnique({ where: { id: h.session.id } })).status, "EXPIRED");
    const second = await sessionService.expireAllStale();
    assert.strictEqual((await prisma.authSession.findUnique({ where: { id: h.session.id } })).status, "EXPIRED");
    assert.ok(second.sessions >= 0);
  });
});
