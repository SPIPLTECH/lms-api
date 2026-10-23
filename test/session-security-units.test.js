/**
 * Google sign-in, session gate and playback — the parts that need no
 * database: credential helpers, Google ID-token verification against real
 * RS256 signatures, the verifyToken middleware's decisions, signed media
 * URLs, video-source redaction, error shapes and media source classification.
 *
 * The database-backed behaviour (atomic single session, second-device
 * rejection, lease races, expiry) is in session-playback.integration.test.js.
 *
 * DATABASE_URL is pointed at a closed local port BEFORE anything loads, so a
 * missed stub fails fast instead of reaching a real (shared) database.
 */
process.env.DATABASE_URL = "postgresql://mock:mock@127.0.0.1:1/never";
delete process.env.TEST_DATABASE_URL;

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "unit-test-access-secret";

const { randomToken, sha256, isWellFormedToken, digestsEqual } = require("../src/utils/sessionCrypto");
const { authError, errorBody, isPublicErrorCode, AUTH_ERRORS } = require("../src/utils/authErrors");
const { withholdVideoSources, shouldWithholdFor } = require("../src/utils/mediaProtection");
const { signMediaToken, verifyMediaToken } = require("../src/modules/playback/mediaToken");
const { classifySource, buildMediaDescriptor } = require("../src/modules/playback/playbackMedia");
const { verifyGoogleIdToken } = require("../src/modules/auth/googleToken.service");
const sessionService = require("../src/modules/sessions/session.service");
const { verifyToken, optionalToken } = require("../src/middleware/auth.middleware");
const errorHandler = require("../src/middleware/error.middleware");

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

test("random tokens are URL-safe, well-formed and unique; only digests compare", () => {
  const a = randomToken(32);
  const b = randomToken(48);
  assert.ok(isWellFormedToken(a) && isWellFormedToken(b));
  assert.notStrictEqual(a, randomToken(32));
  assert.strictEqual(sha256(a).length, 64);
  assert.ok(digestsEqual(sha256(a), sha256(a)));
  assert.ok(!digestsEqual(sha256(a), sha256(b)));
  assert.ok(!isWellFormedToken("short"));
  assert.ok(!isWellFormedToken("has spaces and is long enough to pass length"));
  assert.ok(!isWellFormedToken(undefined));
});

// ---------------------------------------------------------------------------
// Error contract
// ---------------------------------------------------------------------------

test("auth errors keep the existing shape and add the spec's error object", () => {
  const error = authError("SESSION_ALREADY_ACTIVE");
  assert.strictEqual(error.statusCode, 409);
  assert.strictEqual(error.code, "SESSION_ALREADY_ACTIVE");

  const body = errorBody({ requestId: "req-1" }, error.code, error.message);
  assert.deepStrictEqual(body, {
    success: false,
    message: error.message,
    code: "SESSION_ALREADY_ACTIVE",
    error: { code: "SESSION_ALREADY_ACTIVE", message: error.message, requestId: "req-1" },
  });

  for (const code of ["PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE", "PLAYBACK_LEASE_LOST", "SESSION_EXPIRED", "SESSION_INVALID"]) {
    assert.ok(AUTH_ERRORS[code], `${code} is defined`);
  }
  assert.strictEqual(AUTH_ERRORS.PLAYBACK_ACTIVE_ON_ANOTHER_DEVICE.status, 409);
});

const fakeRes = () => {
  const res = { statusCode: 200, body: undefined, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (name, value) => { res.headers[name] = value; };
  return res;
};

test("the global error handler promotes only application codes to `error`", () => {
  const original = console.error;
  console.error = () => {};
  try {
    const res = fakeRes();
    errorHandler(authError("PLAYBACK_LEASE_LOST"), { requestId: "abc" }, res, () => {});
    assert.strictEqual(res.statusCode, 409);
    assert.strictEqual(res.body.code, "PLAYBACK_LEASE_LOST");
    assert.deepStrictEqual(res.body.error, { code: "PLAYBACK_LEASE_LOST", message: res.body.message, requestId: "abc" });

    const prismaRes = fakeRes();
    errorHandler(Object.assign(new Error("db"), { code: "P2002" }), { requestId: "abc" }, prismaRes, () => {});
    assert.strictEqual(prismaRes.body.code, "P2002", "existing behaviour unchanged");
    assert.strictEqual(prismaRes.body.error, undefined, "internal codes are not promoted");
  } finally {
    console.error = original;
  }
  assert.ok(isPublicErrorCode("SESSION_EXPIRED"));
  assert.ok(!isPublicErrorCode("P2025"));
});

// ---------------------------------------------------------------------------
// Google ID token verification (real RS256 signatures, our own key pair)
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "unit-test-kid";
const AUDIENCE = "unit-test-client.apps.googleusercontent.com";
const publicPem = publicKey.export({ type: "spki", format: "pem" });

const googleClient = () => {
  const client = new OAuth2Client();
  // Serve our test certificate instead of fetching Google's.
  client.getFederatedSignonCertsAsync = async () => ({ certs: { [KID]: publicPem }, res: null });
  return client;
};

const googleToken = (claims = {}, { key = privateKey, kid = KID } = {}) => {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: "https://accounts.google.com",
      aud: AUDIENCE,
      sub: "1234567890",
      email: "Student@Example.com",
      email_verified: true,
      iat: now,
      exp: now + 3600,
      ...claims,
    },
    key,
    { algorithm: "RS256", keyid: kid }
  );
};

const verify = (token) => verifyGoogleIdToken(token, { client: googleClient(), audiences: [AUDIENCE] });

test("a valid Google ID token yields the normalised (issuer, sub) identity", async () => {
  const identity = await verify(googleToken());
  assert.deepStrictEqual(identity, {
    issuer: "https://accounts.google.com",
    subject: "1234567890",
    email: "Student@Example.com",
    emailVerified: true,
  });

  // The other issuer spelling maps to the same identity key.
  const bare = await verify(googleToken({ iss: "accounts.google.com" }));
  assert.strictEqual(bare.issuer, "https://accounts.google.com");
});

test("Google tokens failing signature, audience, issuer or expiry are rejected", async () => {
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const now = Math.floor(Date.now() / 1000);
  const cases = {
    "wrong signing key": googleToken({}, { key: other }),
    "unknown key id": googleToken({}, { kid: "someone-else" }),
    "wrong audience": googleToken({ aud: "another-app.apps.googleusercontent.com" }),
    "wrong issuer": googleToken({ iss: "https://evil.example.com" }),
    expired: googleToken({ iat: now - 7200, exp: now - 3600 }),
    "not a JWT": "definitely-not-a-jwt",
  };
  for (const [label, token] of Object.entries(cases)) {
    await assert.rejects(verify(token), (error) => error.code === "GOOGLE_TOKEN_INVALID", label);
  }
});

test("an unverified email is reported as such, never upgraded", async () => {
  const identity = await verify(googleToken({ email_verified: false }));
  assert.strictEqual(identity.emailVerified, false);
});

test("Google sign-in without a configured client id is 503, not a silent pass", async () => {
  await assert.rejects(
    verifyGoogleIdToken(googleToken(), { client: googleClient(), audiences: [] }),
    (error) => error.code === "GOOGLE_AUTH_NOT_CONFIGURED" && error.statusCode === 503
  );
});

// ---------------------------------------------------------------------------
// verifyToken / optionalToken
// ---------------------------------------------------------------------------

const request = ({ token, deviceKey } = {}) => ({
  requestId: "req-test",
  headers: token ? { authorization: `Bearer ${token}` } : {},
  get(name) {
    return name.toLowerCase() === "x-device-key" ? deviceKey : undefined;
  },
});

const accessToken = (claims = {}, options = {}) =>
  jwt.sign({ id: "user-1", email: "a@b.c", role: "STUDENT", sid: "session-1", ...claims }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: "5m",
    ...options,
  });

const runMiddleware = async (middleware, req) => {
  const res = fakeRes();
  let nextCalled = false;
  let nextError;
  await middleware(req, res, (error) => {
    nextCalled = true;
    nextError = error;
  });
  return { res, nextCalled, nextError };
};

// Nobody here is an evaluator account: verifyToken also consults
// utils/evaluatorAccess after the session check.
require("../src/config/database").evaluatorAccess.findUnique = async () => null;

const withValidateAccess = async (impl, fn) => {
  const original = sessionService.validateAccess;
  sessionService.validateAccess = impl;
  try {
    await fn();
  } finally {
    sessionService.validateAccess = original;
  }
};

test("verifyToken: no token is 401 AUTH_REQUIRED", async () => {
  const { res, nextCalled } = await runMiddleware(verifyToken, request());
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, "AUTH_REQUIRED");
  assert.strictEqual(nextCalled, false);
});

test("verifyToken: an expired access token is 401 ACCESS_TOKEN_EXPIRED (refreshable)", async () => {
  const token = accessToken({}, { expiresIn: -10 });
  const { res } = await runMiddleware(verifyToken, request({ token }));
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, "ACCESS_TOKEN_EXPIRED");
});

test("verifyToken: a pre-session token with no sid is 401 SESSION_INVALID", async () => {
  const token = accessToken({ sid: undefined });
  const { res } = await runMiddleware(verifyToken, request({ token }));
  assert.strictEqual(res.body.code, "SESSION_INVALID");
});

test("verifyToken: a token signed with another key is 401 SESSION_INVALID", async () => {
  const token = jwt.sign({ id: "user-1", sid: "session-1" }, "not-our-secret");
  const { res } = await runMiddleware(verifyToken, request({ token }));
  assert.strictEqual(res.body.code, "SESSION_INVALID");
});

test("verifyToken: every request is checked against the session, with the device key", async () => {
  const seen = [];
  await withValidateAccess(async (args) => {
    seen.push(args);
    return { id: "session-1", deviceId: "device-1" };
  }, async () => {
    const req = request({ token: accessToken(), deviceKey: "device-key-abc" });
    const { nextCalled, nextError } = await runMiddleware(verifyToken, req);
    assert.ok(nextCalled && !nextError);
    assert.deepStrictEqual(req.user, { id: "user-1", email: "a@b.c", role: "STUDENT", sessionId: "session-1", deviceId: "device-1" });
  });
  assert.deepStrictEqual(seen, [{ sessionId: "session-1", userId: "user-1", deviceKey: "device-key-abc" }]);
});

test("verifyToken: a revoked/expired/foreign-device session is refused with its code", async () => {
  for (const code of ["SESSION_INVALID", "SESSION_EXPIRED", "ACCOUNT_SUSPENDED"]) {
    await withValidateAccess(async () => { throw authError(code); }, async () => {
      const { res, nextCalled } = await runMiddleware(verifyToken, request({ token: accessToken() }));
      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.body.code, code);
      assert.strictEqual(res.statusCode, AUTH_ERRORS[code].status);
    });
  }
});

test("verifyToken: a database failure is a server error, not a logout", async () => {
  await withValidateAccess(async () => { throw new Error("connection reset"); }, async () => {
    const { nextError } = await runMiddleware(verifyToken, request({ token: accessToken() }));
    assert.match(nextError.message, /connection reset/);
  });
});

test("optionalToken: an invalid session is a GUEST, never the claimed user", async () => {
  await withValidateAccess(async () => { throw authError("SESSION_INVALID"); }, async () => {
    const req = request({ token: accessToken() });
    const { nextCalled } = await runMiddleware(optionalToken, req);
    assert.ok(nextCalled);
    assert.deepStrictEqual(req.user, { role: "GUEST" });
  });
  const anonymous = request();
  await runMiddleware(optionalToken, anonymous);
  assert.deepStrictEqual(anonymous.user, { role: "GUEST" });
});

// ---------------------------------------------------------------------------
// Signed media URLs
// ---------------------------------------------------------------------------

test("media tokens verify, and forged, edited or expired ones do not", () => {
  const expiresAt = new Date(Date.now() + 60_000);
  const token = signMediaToken({ leaseId: "lease-1", contentId: "content-1", expiresAt });
  const claims = verifyMediaToken(token);
  assert.strictEqual(claims.leaseId, "lease-1");
  assert.strictEqual(claims.contentId, "content-1");

  const [payload, signature] = token.split(".");
  const edited = Buffer.from(JSON.stringify({ l: "lease-2", c: "content-1", e: Math.floor(expiresAt / 1000) })).toString("base64url");
  assert.strictEqual(verifyMediaToken(`${edited}.${signature}`), null, "payload edit breaks the signature");
  assert.strictEqual(verifyMediaToken(`${payload}.${signature.slice(0, -2)}xx`), null, "forged signature");
  assert.strictEqual(verifyMediaToken(`${payload}.${signature}.extra`), null);
  assert.strictEqual(verifyMediaToken("garbage"), null);

  const expired = signMediaToken({ leaseId: "lease-1", contentId: "content-1", expiresAt: new Date(Date.now() - 1000) });
  assert.strictEqual(verifyMediaToken(expired), null);
});

// ---------------------------------------------------------------------------
// Video-source redaction
// ---------------------------------------------------------------------------

test("students and guests never receive a VIDEO source; other content is untouched", () => {
  const course = {
    id: "c1",
    contents: [
      { id: "v1", type: "VIDEO", videoUrl: "https://youtu.be/abcdefghijk", fileUrl: null, externalUrl: null, title: "Intro" },
      { id: "p1", type: "PDF", videoUrl: null, fileUrl: "https://files.example/a.pdf", externalUrl: null },
    ],
    modules: [{ lessons: [{ topics: [{ contents: [{ id: "v2", type: "VIDEO", videoUrl: null, fileUrl: "/uploads/contents/x.mp4" }] }] }] }],
  };
  const out = withholdVideoSources(course);

  assert.deepStrictEqual(out.contents[0], {
    id: "v1", type: "VIDEO", videoUrl: null, fileUrl: null, externalUrl: null, title: "Intro", mediaProtected: true,
  });
  assert.strictEqual(out.contents[1], course.contents[1], "non-video rows are passed through untouched");
  assert.strictEqual(out.modules[0].lessons[0].topics[0].contents[0].fileUrl, null);
  assert.strictEqual(out.modules[0].lessons[0].topics[0].contents[0].mediaProtected, true);
  assert.strictEqual(course.contents[0].videoUrl, "https://youtu.be/abcdefghijk", "input not mutated");
});

test("learning-sequence step bodies are redacted too; locked rows stay unplayable", () => {
  const sequence = {
    steps: [
      { type: "VIDEO", contentId: "v1", body: { videoUrl: "https://x.blob.vercel-storage.com/v.mp4", fileUrl: null, externalUrl: null, htmlContent: null } },
      { type: "VIDEO", contentId: "v2", locked: true, body: { videoUrl: null, fileUrl: null, externalUrl: null } },
      { type: "HTML", contentId: "h1", body: { videoUrl: null, htmlContent: "<p>hi</p>" } },
    ],
  };
  const out = withholdVideoSources(sequence);
  assert.strictEqual(out.steps[0].body.videoUrl, null);
  assert.strictEqual(out.steps[0].body.mediaProtected, true);
  assert.strictEqual(out.steps[1].body.mediaProtected, false, "no source to protect: the player shows it as unavailable");
  assert.strictEqual(out.steps[2], sequence.steps[2]);
});

test("an upload response with type VIDEO but no videoUrl key is left alone", () => {
  const upload = { success: true, data: { fileName: "a.mp4", fileUrl: "http://api/uploads/attachments/a.mp4", type: "VIDEO" } };
  assert.strictEqual(withholdVideoSources(upload), upload);
});

test("only instructors and admins see raw sources", () => {
  assert.ok(shouldWithholdFor({ role: "STUDENT" }));
  assert.ok(shouldWithholdFor({ role: "GUEST" }));
  assert.ok(shouldWithholdFor(undefined));
  assert.ok(!shouldWithholdFor({ role: "INSTRUCTOR" }));
  assert.ok(!shouldWithholdFor({ role: "ADMIN" }));
});

// ---------------------------------------------------------------------------
// Media source classification
// ---------------------------------------------------------------------------

test("sources are classified by what the LMS can actually protect", () => {
  assert.strictEqual(classifySource("https://www.youtube.com/watch?v=abcdefghijk").kind, "youtube");
  assert.strictEqual(classifySource("https://youtu.be/abcdefghijk").kind, "youtube");
  assert.strictEqual(classifySource("https://vimeo.com/123").kind, "vimeo");
  assert.deepStrictEqual(classifySource("https://store.private.blob.vercel-storage.com/v.mp4"), {
    kind: "blob",
    url: "https://store.private.blob.vercel-storage.com/v.mp4",
    isPrivate: true,
  });
  assert.strictEqual(classifySource("https://store.public.blob.vercel-storage.com/v.mp4").isPrivate, false);
  assert.strictEqual(classifySource("http://store.public.blob.vercel-storage.com/v.mp4").kind, "external", "blob over plain http is not proxied");
  assert.strictEqual(classifySource("https://cdn.example.com/v.mp4").kind, "external");
  assert.strictEqual(classifySource("http://169.254.169.254/latest/meta-data").kind, "external", "never proxied upstream");
  assert.strictEqual(classifySource("/uploads/../../.env").kind, "none", "path traversal is not a local file");
  assert.strictEqual(classifySource("").kind, "none");
});

test("only lease-gated sources get a signed URL; the rest are handed out as-is after the lease", () => {
  const lease = { id: "lease-9" };
  const blob = buildMediaDescriptor(
    { id: "v1", videoUrl: "https://s.private.blob.vercel-storage.com/v.mp4" },
    lease,
    { maxAgeSeconds: 60 }
  );
  assert.strictEqual(blob.kind, "file");
  assert.strictEqual(blob.protected, true);
  assert.match(blob.url, /^\/playback\/media\/[^/]+$/);
  assert.strictEqual(verifyMediaToken(blob.url.split("/").pop()).leaseId, "lease-9");
  assert.ok(!blob.url.includes("vercel-storage"), "the storage URL is not disclosed");

  const youtube = buildMediaDescriptor({ id: "v2", videoUrl: "https://youtu.be/abcdefghijk" }, lease, { maxAgeSeconds: 60 });
  assert.deepStrictEqual(youtube, { kind: "youtube", url: "https://youtu.be/abcdefghijk", protected: false });

  assert.strictEqual(buildMediaDescriptor({ id: "v3", videoUrl: null }, lease, { maxAgeSeconds: 60 }), null);
});

test("device labels are coarse (browser + OS), not a fingerprint", () => {
  assert.strictEqual(
    sessionService.deviceLabelFrom("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"),
    "Chrome on Windows"
  );
  assert.strictEqual(sessionService.deviceLabelFrom(null), null);
});
